import { randomBytes } from "node:crypto";

import type { Transaction } from "sequelize";

import { paymentConfig } from "../../config/payment.config.js";
import { sequelize } from "../../database/index.js";
import { Order } from "../../database/tables/OrderTable/index.js";
import { OrderItem } from "../../database/tables/OrderItemTable/index.js";
import { Payment } from "../../database/tables/PaymentTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { TokenService } from "../../services/auth/token.service.js";
import { logger } from "../../utils/logger.js";
import { formatMoney } from "../../utils/product-money.js";
import { CartService } from "../CartModels/cart.service.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import { isValidOrderStatusTransition } from "../OrderModels/order.constants.js";
import { OrderNotFoundError } from "../OrderModels/order.errors.js";
import { CheckoutCodUnavailableError } from "../CheckoutModels/checkout.errors.js";
import { ServiceabilityService } from "../ShipmentModels/serviceability.service.js";
import {
  OrderAlreadyPaidError,
  PaymentAttemptAlreadyActiveError,
  PaymentCustomerOrderIdRequiredError,
  PaymentGuestTokenRequiredError,
  PaymentOrderNotPayableError,
  PaymentProviderNotConfiguredError
} from "./payment.errors.js";
import { BreezeService } from "./breeze.service.js";
import { PaymentFinalizationService, lockAndCheckOrderStock } from "./payment-finalization.service.js";
import { buildPayuRequestHash } from "./payu-hash.util.js";
import { normalizeVerifyApiResult } from "./payu-result-normalizer.js";
import { PayuVerifyClient } from "./payu-verify.client.js";
import type { BreezeStartPaymentParamsJSON } from "./breeze.types.js";
import type {
  CodConfirmationResultJSON,
  ConfirmCodOrderInput,
  CreatePaymentAttemptInput,
  InitiatePaymentInput,
  PaymentAttemptResult,
  PaymentInitiationCaller,
  PaymentInitiationResultJSON,
  PaymentProvider,
  PaymentStatusResultJSON
} from "./payment.types.js";

function buildCodResult(order: Order, payment: Payment): CodConfirmationResultJSON {
  return {
    provider: "cod",
    paymentId: payment.id,
    orderId: order.id,
    orderStatus: order.status,
    paymentStatus: payment.status,
    amount: payment.amount,
    currency: payment.currency
  };
}

/**
 * Completes the COD payment lifecycle once an Order is confirmed delivered.
 * Cash on Delivery funds are only actually collected at the door — this is
 * the reconciliation step deferred by confirmCodOrder() below (see its own
 * comment: "status stays 'pending' forever in Phase 1... collection
 * reconciliation is a future admin action"), now closed by treating courier-
 * confirmed (or admin-confirmed) delivery as that collection event.
 *
 * Idempotent no-op when this Order has no COD Payment (a PayU Order, for
 * example — never touched by this function) or when its COD Payment has
 * already left "pending" (already paid by an earlier call, or independently
 * failed/refunded/cancelled) — safe to call from every code path that can
 * ever drive an Order to "delivered" (automatic shipment-tracking sync AND
 * manual admin status update) without risking a double-apply.
 *
 * Mutates the passed `order` instance's payment_status in place rather than
 * writing it directly — every caller already loads the Order row locked
 * (LOCK.UPDATE) and calls order.save() itself right after setting
 * status/fulfilment_status, so this piggybacks on that same single write
 * instead of issuing a second, separately-racing UPDATE. Must be called
 * inside that same transaction, on that same locked row, so the "delivered"
 * transition and the payment reconciliation can never observably diverge.
 */
async function markCodDelivered(order: Order, deliveredAt: Date, transaction: Transaction): Promise<void> {
  const payment = await Payment.findOne({
    where: { order_id: order.id, provider: "cod" },
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (!payment) {
    return;
  }
  if (payment.status !== "pending") {
    return;
  }

  payment.status = "paid";
  payment.paid_at = deliveredAt;
  await payment.save({ transaction });

  order.payment_status = "paid";
}

/**
 * Generates the PayU merchant transaction id (txnid) for a Payment Attempt.
 * Unlike buildBusinessReference (used for ORD-/CUS-/ADM- style internal
 * display codes, which are fine being deterministic from an auto-increment
 * id), PayU requires txnid to be globally unique for the merchant key
 * forever — not just unique within this database. A purely id-derived value
 * like "PAY-000001" collides the moment the payments table is reseeded or
 * restored (the id sequence restarts from 1), reusing a txnid PayU's test
 * or live environment already captured previously, which PayU then rejects
 * outright ("This txnid has been used previously or was successfully
 * captured."). The payment id is kept as a prefix for support traceability;
 * the random suffix is what actually guarantees uniqueness across resets.
 */
function generatePayuTxnId(paymentId: number): string {
  const random = randomBytes(5).toString("hex");
  return `PAY-${String(paymentId).padStart(6, "0")}-${random}`;
}

/**
 * Breeze equivalent of generatePayuTxnId — the merchant transaction
 * reference sent to Breeze as `startPayment.orderId` and stored in
 * Payment.provider_order_id. Same "payment id prefix for support
 * traceability + random suffix for global uniqueness across DB resets"
 * rationale as the PayU version. `BRZ-` prefix keeps the two providers'
 * references trivially distinguishable in logs.
 */
function generateBreezeTxnRef(paymentId: number): string {
  const random = randomBytes(5).toString("hex");
  return `BRZ-${String(paymentId).padStart(6, "0")}-${random}`;
}

/**
 * Reconciles a still-"pending" Payment Attempt against PayU's Verify
 * Payment API before any caller treats its local "pending" status as
 * current truth. Originally only ever called reactively (getPaymentStatus,
 * when the browser/customer explicitly asks) — that left two real gaps:
 * (1) initiatePayuCheckout would reuse a pending attempt's txnid for a
 * fresh PayU submission without first checking whether PayU had already
 * captured it on a prior attempt, which PayU then bounces with its own
 * generic "txnid has been used previously or was successfully captured"
 * page; (2) OrderModels.createOrder would reject a new Order as
 * OrderAlreadyPendingError purely because an old Order still looked
 * "pending" locally, even when it had actually already been paid. Calling
 * this proactively before either of those decisions closes both gaps. A
 * network/provider failure here is logged and swallowed — the caller
 * proceeds with the last-known local state, exactly like every other
 * reconciliation path in this codebase.
 */
async function reconcilePendingAttempt(payment: Payment): Promise<void> {
  if (!payment.provider_order_id) {
    return;
  }
  // Provider-specific reconciliation. PayU has a documented Verify Payment
  // API used here as a proactive cross-check. Breeze has NO documented
  // client-pollable status/verify API for the startPayment flow — its
  // authoritative confirmation is the S2S webhook — so a pending Breeze
  // attempt is simply left as-is until that webhook arrives (the terminal-
  // status guard in PaymentFinalizationService keeps that idempotent).
  // TODO — BREEZE CONFIRMATION REQUIRED: a Breeze payment/order status query
  // API, if one exists, would slot in here as a BreezeVerifyClient.
  if (payment.provider !== "payu") {
    return;
  }
  try {
    const raw = await PayuVerifyClient.verifyPayment(payment.provider_order_id);
    const normalized = normalizeVerifyApiResult(payment.provider_order_id, raw);
    await PaymentFinalizationService.processVerifiedPaymentResult(normalized);
  } catch (error) {
    logger.warn({ err: error, paymentAttemptId: payment.id }, "payment reconciliation: Verify Payment API call failed, proceeding with last-known local state");
  }
}

export const PaymentService = {
  reconcilePendingAttempt,
  markCodDelivered,

  /**
   * Creates a new Payment Attempt for a given Order.
   * Enforces that only one active (pending) attempt exists at a time using row-level locking.
   * Snapshots the amount and currency from the Order.
   */
  async createPaymentAttempt(input: CreatePaymentAttemptInput): Promise<PaymentAttemptResult> {
    const provider: PaymentProvider = input.provider ?? "payu";
    return sequelize.transaction(async (transaction) => {
      // 1. Lock the Order row to serialize concurrent payment attempt creations.
      const order = await Order.findByPk(input.orderId, {
        transaction,
        lock: transaction.LOCK.UPDATE
      });

      if (!order) {
        throw new OrderNotFoundError(input.orderId);
      }

      // 2. Treat PAYMENT as already completed based primarily on payment state:
      // Order.payment_status === "paid" OR an already successful/paid Payment attempt where applicable.
      if (order.payment_status === "paid") {
        throw new OrderAlreadyPaidError(order.id);
      }

      // Check if there is an existing 'paid' payment attempt directly as a secondary guard.
      const existingPaidAttempt = await Payment.findOne({
        where: { order_id: order.id, status: "paid" },
        transaction
      });
      if (existingPaidAttempt) {
        throw new OrderAlreadyPaidError(order.id);
      }

      // An Order already confirmed for Cash on Delivery (see
      // PaymentService.confirmCodOrder) must never also spawn a PayU
      // attempt — order.payment_status stays "pending" for COD (it is never
      // marked "paid"), so the check above alone cannot catch this case. A
      // "cod" Payment's existence is itself the durable marker that this
      // Order's payment method is already decided.
      const existingCodPayment = await Payment.findOne({
        where: { order_id: order.id, provider: "cod" },
        transaction
      });
      if (existingCodPayment) {
        throw new PaymentOrderNotPayableError(order.id, "the order has already been confirmed for Cash on Delivery.");
      }

      // 3. Inspect existing active pending Payment for THIS provider. Scoped
      // by provider so a long-lived pending COD Payment (see
      // PaymentService.confirmCodOrder) — and, now, a pending attempt for the
      // *other* online provider — is never mistaken for, or silently
      // overwritten as, this provider's active attempt. Switching online
      // providers mid-Order is still blocked below (a pending attempt for the
      // other online provider surfaces as PaymentAttemptAlreadyActiveError
      // via the initiate* orchestrators, not here).
      const activeAttempt = await Payment.findOne({
        where: { order_id: order.id, status: "pending", provider },
        transaction
      });

      if (activeAttempt) {
        throw new PaymentAttemptAlreadyActiveError(order.id);
      }

      // 4. Allocate ID for Payment
      const paymentId = await IdSequenceService.allocateNextId("payments", transaction);

      // 5. Snapshot amount/currency and create the new Payment Attempt.
      // provider is as selected (default "payu"); provider IDs and payload
      // remain null until the gateway/webhook fills them in.
      const payment = await Payment.create(
        {
          id: paymentId,
          order_id: order.id,
          amount: order.total,
          currency: order.currency,
          provider,
          status: "pending",
          provider_order_id: null,
          provider_payment_id: null,
          method: null,
          raw_payload: null
        },
        { transaction }
      );

      return payment;
    });
  },

  /**
   * Resolves an existing active (pending) Payment Attempt for an Order, or
   * creates one via createPaymentAttempt above if none exists. Does NOT
   * duplicate createPaymentAttempt's own locking/eligibility logic — it is
   * called first and its already-tested throw behavior
   * (PaymentAttemptAlreadyActiveError, OrderAlreadyPaidError) is preserved
   * unchanged. The only new behavior here is catching the "already active"
   * case and reusing that existing row instead of treating it as a caller
   * error — this is what makes a double-click, page refresh, or network
   * retry during initiation land on the same Payment Attempt rather than
   * failing or creating an unsafe duplicate.
   */
  async getOrCreateActiveAttempt(orderId: number, provider: PaymentProvider = "payu"): Promise<PaymentAttemptResult> {
    try {
      return await this.createPaymentAttempt({ orderId, provider });
    } catch (error) {
      if (error instanceof PaymentAttemptAlreadyActiveError) {
        // Scoped to the same provider — see the matching comment on
        // createPaymentAttempt's own activeAttempt lookup above.
        const existing = await Payment.findOne({ where: { order_id: orderId, status: "pending", provider } });
        if (existing) {
          return existing;
        }
      }
      throw error;
    }
  },

  /**
   * Assigns the stable PayU merchant transaction identity (txnid) to a
   * Payment Attempt exactly once. Locks the Payment row so two concurrent
   * initiation requests resolving the same reused attempt can never commit
   * two different txnids — the second request to acquire the lock sees the
   * first's already-committed value and reuses it verbatim. Stored in
   * provider_order_id: PayU's own vocabulary is "the merchant's order/
   * transaction reference", which is exactly what provider_order_id already
   * models on this table (as distinct from provider_payment_id, which is
   * PayU's own mihpayid — assigned only once PayU responds, never here).
   */
  async ensureProviderTransactionId(paymentId: number): Promise<PaymentAttemptResult> {
    return sequelize.transaction(async (t) => {
      const payment = await Payment.findByPk(paymentId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!payment) {
        // Invariant violation, not a caller-facing error: paymentId always
        // comes from a Payment row this same request just created or found.
        throw new Error(`Payment '${paymentId}' was not found while assigning its provider transaction id.`);
      }
      if (payment.provider_order_id) {
        return payment;
      }
      payment.provider_order_id = payment.provider === "breeze" ? generateBreezeTxnRef(payment.id) : generatePayuTxnId(payment.id);
      await payment.save({ transaction: t });
      return payment;
    });
  },

  /**
   * Verifies the Order exists and resolves to the caller's identity:
   * a customer's session must own it (order.user_id match — the same
   * non-enumerating findOne-by-owner pattern OrderService.getCustomerOrder
   * already uses, so "doesn't exist" and "not yours" are indistinguishable
   * to the caller); a guest must present the same opaque, high-entropy
   * recovery token already issued for that exact Order at creation
   * (hashed and matched against orders.guest_access_token_hash — the same
   * mechanism OrderService.getGuestOrder uses for guest Order recovery).
   * A numeric orderId is never, by itself, sufficient proof of guest
   * ownership — see PaymentGuestTokenRequiredError/PaymentCustomerOrderIdRequiredError.
   */
  async resolveAuthorizedOrder(caller: PaymentInitiationCaller, input: InitiatePaymentInput): Promise<Order> {
    if (caller.type === "customer") {
      if (input.orderId === undefined) {
        throw new PaymentCustomerOrderIdRequiredError();
      }
      const order = await Order.findOne({ where: { id: input.orderId, user_id: caller.userId } });
      if (!order) {
        throw new OrderNotFoundError(input.orderId);
      }
      return order;
    }

    if (!input.guestAccessToken) {
      throw new PaymentGuestTokenRequiredError();
    }
    const tokenHash = TokenService.hashToken(input.guestAccessToken);
    const order = await Order.findOne({ where: { guest_access_token_hash: tokenHash, user_id: null } });
    if (!order) {
      throw new OrderNotFoundError("guest order");
    }
    return order;
  },

  /**
   * Eligibility checks beyond what createPaymentAttempt itself enforces
   * (single active attempt, not already paid). These guard against
   * initiating PayU checkout for an Order that is structurally unpayable —
   * none of these should be reachable in practice given Order Creation's own
   * invariants, but are asserted explicitly here since Payment Initiation is
   * the first place Order data is sent to an external party.
   */
  assertOrderPayable(order: Order, itemCount: number): void {
    if (order.status === "cancelled") {
      throw new PaymentOrderNotPayableError(order.id, "the order has been cancelled.");
    }
    if (order.status === "return_requested") {
      throw new PaymentOrderNotPayableError(order.id, "the order is in a post-delivery return state.");
    }
    if (!order.contact_email) {
      throw new PaymentOrderNotPayableError(order.id, "the order has no contact email on file.");
    }
    if (!order.ship_phone) {
      throw new PaymentOrderNotPayableError(order.id, "the order has no contact phone on file.");
    }
    if (itemCount === 0) {
      throw new PaymentOrderNotPayableError(order.id, "the order has no items.");
    }
  },

  /**
   * Builds the safe PayU Hosted Checkout browser-handoff payload for an
   * already-resolved Payment Attempt. Amount/currency/customer fields all
   * originate from the persisted Order/Payment snapshot — never from the
   * request body — so the browser has no path to influence what PayU is
   * asked to charge. The merchant salt is read once, used only as a hash
   * input, and never placed on the returned object.
   */
  buildHostedCheckoutFields(order: Order, payment: PaymentAttemptResult, productinfo: string): PaymentInitiationResultJSON {
    if (!paymentConfig.payuKey || !paymentConfig.payuSalt) {
      throw new PaymentProviderNotConfiguredError();
    }
    if (!payment.provider_order_id) {
      throw new Error("Payment Attempt is missing its provider transaction id.");
    }

    const [firstNameRaw, ...restName] = order.ship_recipient_name.trim().split(/\s+/);
    const firstname = (firstNameRaw || "Customer").replace(/[^a-zA-Z0-9]/g, "") || "Customer";
    void restName;

    const amount = formatMoney(payment.amount);
    const txnid = payment.provider_order_id;
    const email = order.contact_email?.trim() || "customer@example.com";
    const rawPhone = order.ship_phone ? order.ship_phone.replace(/\D/g, "") : "";
    const phone = rawPhone.length >= 10 ? rawPhone.slice(-10) : "9999999999";
    const udf1 = String(order.id);
    const sanitizedProductInfo = productinfo.replace(/[^a-zA-Z0-9\s-]/g, " ").trim().slice(0, 255) || "Order Purchase";

    const hash = buildPayuRequestHash(
      {
        key: paymentConfig.payuKey,
        txnid,
        amount,
        productinfo: sanitizedProductInfo,
        firstname,
        email,
        udf1
      },
      paymentConfig.payuSalt
    );

    const resFields = {
      key: paymentConfig.payuKey,
      txnid,
      amount,
      productinfo: sanitizedProductInfo,
      firstname,
      email,
      phone,
      surl: paymentConfig.successReturnUrl,
      furl: paymentConfig.failureReturnUrl,
      udf1,
      hash,
      service_provider: "payu_paisa"
    };

    return {
      provider: "payu",
      gatewayUrl: paymentConfig.gatewayUrl,
      fields: resFields
    };
  },

  /**
   * Full Payment Initiation orchestration: authorize the caller against the
   * Order, verify it is payable, reuse or create the single active Payment
   * Attempt, assign (or reuse) its stable PayU transaction id, and return the
   * safe Hosted Checkout handoff payload. Payment.status remains "pending"
   * and Order.status/payment_status are never touched — this only ever
   * prepares a PayU request; it never finalizes one.
   */
  async initiatePayuCheckout(caller: PaymentInitiationCaller, input: InitiatePaymentInput): Promise<PaymentInitiationResultJSON> {
    const order = await this.resolveAuthorizedOrder(caller, input);
    const itemCount = await OrderItem.count({ where: { order_id: order.id } });
    this.assertOrderPayable(order, itemCount);

    // Reconcile any existing pending attempt with PayU BEFORE deciding
    // whether to reuse its txnid — otherwise a payment that actually
    // succeeded on a previous submission gets resubmitted with the same
    // txnid and bounced by PayU's own duplicate-txnid protection, stranding
    // the customer on PayU's raw error page instead of our result page.
    // Scoped to provider: "payu" — see the matching comment on
    // createPaymentAttempt's activeAttempt lookup; a long-lived pending COD
    // Payment on this Order must never be reconciled against PayU's Verify
    // Payment API (it has no provider_order_id to verify) or otherwise
    // treated as this method's own attempt.
    const existingPendingAttempt = await Payment.findOne({ where: { order_id: order.id, status: "pending", provider: "payu" } });
    if (existingPendingAttempt) {
      await reconcilePendingAttempt(existingPendingAttempt);
    }

    const reconciledOrder = await Order.findByPk(order.id);
    if (reconciledOrder?.payment_status === "paid") {
      throw new OrderAlreadyPaidError(order.id);
    }

    const attempt = await this.getOrCreateActiveAttempt(order.id);
    const attemptWithTxnId = await this.ensureProviderTransactionId(attempt.id);

    const items = await OrderItem.findAll({ where: { order_id: order.id }, order: [["id", "ASC"]], limit: 1 });
    const productinfo = itemCount === 1 && items[0] ? items[0].product_name : `MyPetMart Order ${order.order_number} (${itemCount} items)`;

    return this.buildHostedCheckoutFields(order, attemptWithTxnId, productinfo);
  },

  /**
   * Breeze equivalent of initiatePayuCheckout for the documented
   * `sendOTP -> verifyOTP -> startPayment` Web SDK flow. The OTP steps run
   * entirely in the browser via @juspay/blaze-sdk-web (no backend round-trip
   * and no frontend key, per Breeze). This method only:
   *   - authorizes the caller against the Order (same resolveAuthorizedOrder),
   *   - verifies the Order is payable,
   *   - blocks switching online providers mid-Order,
   *   - reuses or creates the single active provider:"breeze" Payment Attempt,
   *   - assigns (or reuses) its stable Breeze transaction reference,
   *   - returns server-authoritative values for the SDK `startPayment` call.
   *
   * Payment.status stays "pending" and Order.status/payment_status are never
   * touched here — finalization happens only via the Breeze S2S webhook ->
   * PaymentFinalizationService, exactly like PayU.
   */
  async initiateBreezeCheckout(caller: PaymentInitiationCaller, input: InitiatePaymentInput): Promise<BreezeStartPaymentParamsJSON> {
    if (!BreezeService.isConfigured()) {
      throw new PaymentProviderNotConfiguredError();
    }

    const order = await this.resolveAuthorizedOrder(caller, input);
    const itemCount = await OrderItem.count({ where: { order_id: order.id } });
    this.assertOrderPayable(order, itemCount);

    // Block switching online providers mid-Order. A still-pending PayU attempt
    // means PayU checkout was already started for this Order — reconcile it
    // first (it may have actually succeeded on a prior submission), then hard-
    // block rather than silently opening a second online attempt.
    const pendingPayuAttempt = await Payment.findOne({ where: { order_id: order.id, status: "pending", provider: "payu" } });
    if (pendingPayuAttempt) {
      await reconcilePendingAttempt(pendingPayuAttempt);
      const refreshed = await Order.findByPk(order.id);
      if (refreshed?.payment_status === "paid") {
        throw new OrderAlreadyPaidError(order.id);
      }
      throw new PaymentAttemptAlreadyActiveError(order.id);
    }

    // getOrCreateActiveAttempt -> createPaymentAttempt already enforces:
    // not already paid, no successful attempt, not already a COD Order, and
    // one active pending attempt per provider. Re-calling with an existing
    // pending Breeze attempt reuses the same provider_order_id, which is the
    // intended retry path (Breeze's own idempotency + the finalizer's
    // terminal-status guard make a duplicate startPayment safe).
    const attempt = await this.getOrCreateActiveAttempt(order.id, "breeze");
    const attemptWithRef = await this.ensureProviderTransactionId(attempt.id);

    return BreezeService.buildStartPaymentParams(order, attemptWithRef);
  },

  /**
   * Browser-return reconciliation surface for the storefront result page.
   * Ownership uses the exact same resolveAuthorizedOrder as initiation — a
   * numeric orderId is never sufficient alone for a guest, and this can
   * never be used to look up a Payment by its numeric id directly. Returns
   * MyPetMart-normalized state only, never the raw PayU payload.
   *
   * If the most recent Payment Attempt is still "pending" and already has a
   * provider transaction id, this calls PayU's Verify Payment API (a real
   * network call, deliberately made here — outside any DB transaction —
   * before handing the result to PaymentFinalizationService, exactly like
   * the webhook path does). A network/provider failure during that
   * reconciliation attempt is logged and swallowed rather than failing the
   * request: the caller still gets the last-known local state instead of an
   * error, and can safely re-poll.
   */
  async getPaymentStatus(caller: PaymentInitiationCaller, input: InitiatePaymentInput): Promise<PaymentStatusResultJSON> {
    const order = await this.resolveAuthorizedOrder(caller, input);
    const payment = await Payment.findOne({ where: { order_id: order.id }, order: [["id", "DESC"]] });

    if (!payment) {
      return {
        paymentStatus: "pending",
        orderId: order.id,
        orderStatus: order.status,
        amount: order.total,
        currency: order.currency,
        commerceException: order.commerce_exception
      };
    }

    if (payment.status === "pending") {
      await reconcilePendingAttempt(payment);
    }

    const [refreshedOrder, refreshedPayment] = await Promise.all([Order.findByPk(order.id), Payment.findByPk(payment.id)]);

    return {
      paymentStatus: refreshedPayment?.status ?? payment.status,
      orderId: order.id,
      orderStatus: refreshedOrder?.status ?? order.status,
      amount: payment.amount,
      currency: payment.currency,
      commerceException: refreshedOrder?.commerce_exception ?? order.commerce_exception
    };
  },

  /**
   * Confirms an Order for Cash on Delivery. Unlike initiatePayuCheckout, this
   * never hands off to an external gateway and never marks anything "paid" —
   * the created Payment row stays provider:"cod", status:"pending" forever in
   * Phase 1 (collection reconciliation is a future admin action, out of
   * scope here). What it DOES do, atomically, is exactly what
   * PaymentFinalizationService's SUCCESS path does for a verified PayU
   * payment minus the "paid" marking: lock-and-check stock, decrement it,
   * and move the Order pending -> confirmed — reusing the same
   * lockAndCheckOrderStock helper so COD and PayU can never diverge on how
   * stock is checked/decremented. Order.payment_status is never touched here
   * (stays "pending"), preserving the existing invariant that "paid" means
   * only "a provider actually captured funds" (see admin-order.routes.ts).
   */
  async confirmCodOrder(caller: PaymentInitiationCaller, input: ConfirmCodOrderInput): Promise<CodConfirmationResultJSON> {
    const order = await this.resolveAuthorizedOrder(caller, input);
    const itemCount = await OrderItem.count({ where: { order_id: order.id } });
    this.assertOrderPayable(order, itemCount);

    // This is a lookup against the immutable Order shipping snapshot and is
    // intentionally outside the transaction below. A replay of an existing
    // COD confirmation remains idempotent even if iThink is unavailable.
    const existingCodPayment = await Payment.findOne({ where: { order_id: order.id, provider: "cod", status: "pending" } });
    if (existingCodPayment) {
      return buildCodResult(order, existingCodPayment);
    }

    const codServiceable = await ServiceabilityService.checkDestination(order.ship_postal_code, "cod");
    if (!codServiceable) {
      throw new CheckoutCodUnavailableError();
    }

    const result = await sequelize.transaction(async (t) => {
      // Lock the Order row to serialize concurrent COD confirmation / PayU
      // initiation attempts for the same Order — the same precedent
      // createPaymentAttempt already sets for PayU.
      const lockedOrder = await Order.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!lockedOrder) {
        throw new OrderNotFoundError(order.id);
      }

      if (lockedOrder.payment_status === "paid") {
        throw new OrderAlreadyPaidError(lockedOrder.id);
      }

      const activeAttempt = await Payment.findOne({ where: { order_id: lockedOrder.id, status: "pending" }, transaction: t });
      if (activeAttempt) {
        if (activeAttempt.provider === "cod") {
          // Idempotent replay (double-click / retry) — this Order was
          // already confirmed for COD; a COD Payment's status never leaves
          // "pending" in Phase 1, so this is the durable marker of "already
          // done" rather than "still open", unlike a pending PayU attempt.
          return buildCodResult(lockedOrder, activeAttempt);
        }
        // A PayU attempt is still active for this Order — block switching to
        // COD mid-attempt rather than silently creating a second Payment
        // Attempt (the same single-active-attempt invariant createPaymentAttempt enforces).
        throw new PaymentAttemptAlreadyActiveError(lockedOrder.id);
      }

      if (!isValidOrderStatusTransition(lockedOrder.status, "confirmed")) {
        throw new PaymentOrderNotPayableError(lockedOrder.id, "the order is not in a state that can be confirmed.");
      }

      const lockedLines = await lockAndCheckOrderStock(lockedOrder.id, t);
      if (!lockedLines) {
        throw new PaymentOrderNotPayableError(lockedOrder.id, "one or more items in this order are no longer in stock.");
      }

      const paymentId = await IdSequenceService.allocateNextId("payments", t);
      const payment = await Payment.create(
        {
          id: paymentId,
          order_id: lockedOrder.id,
          amount: lockedOrder.total,
          currency: lockedOrder.currency,
          provider: "cod",
          status: "pending",
          provider_order_id: null,
          provider_payment_id: null,
          method: "cod",
          raw_payload: null
        },
        { transaction: t }
      );

      for (const line of lockedLines) {
        if (line.variant) {
          line.variant.stock = line.availableStock - line.item.quantity;
          await line.variant.save({ transaction: t });
        } else {
          line.product.stock = line.availableStock - line.item.quantity;
          await line.product.save({ transaction: t });
        }
      }

      lockedOrder.status = "confirmed";
      await lockedOrder.save({ transaction: t });

      await CartService.finalizeCartForOrder(lockedOrder, t);

      return buildCodResult(lockedOrder, payment);
    });

    // Post-commit — the same "commit first, then notify" boundary
    // payment-finalization.service.ts uses. Never throws, never affects the
    // COD confirmation that already committed above.
    await CommerceNotifications.codOrderConfirmed(order.id);

    return result;
  }
};
