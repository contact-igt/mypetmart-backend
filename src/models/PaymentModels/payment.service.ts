import { randomBytes } from "node:crypto";

import { paymentConfig } from "../../config/payment.config.js";
import { sequelize } from "../../database/index.js";
import { Order } from "../../database/tables/OrderTable/index.js";
import { OrderItem } from "../../database/tables/OrderItemTable/index.js";
import { Payment } from "../../database/tables/PaymentTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { TokenService } from "../../services/auth/token.service.js";
import { logger } from "../../utils/logger.js";
import { formatMoney } from "../../utils/product-money.js";
import { OrderNotFoundError } from "../OrderModels/order.errors.js";
import {
  OrderAlreadyPaidError,
  PaymentAttemptAlreadyActiveError,
  PaymentCustomerOrderIdRequiredError,
  PaymentGuestTokenRequiredError,
  PaymentOrderNotPayableError,
  PaymentProviderNotConfiguredError
} from "./payment.errors.js";
import { PaymentFinalizationService } from "./payment-finalization.service.js";
import { buildPayuRequestHash } from "./payu-hash.util.js";
import { normalizeVerifyApiResult } from "./payu-result-normalizer.js";
import { PayuVerifyClient } from "./payu-verify.client.js";
import type {
  CreatePaymentAttemptInput,
  InitiatePaymentInput,
  PaymentAttemptResult,
  PaymentInitiationCaller,
  PaymentInitiationResultJSON,
  PaymentStatusResultJSON
} from "./payment.types.js";

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

export const PaymentService = {
  /**
   * Creates a new Payment Attempt for a given Order.
   * Enforces that only one active (pending) attempt exists at a time using row-level locking.
   * Snapshots the amount and currency from the Order.
   */
  async createPaymentAttempt(input: CreatePaymentAttemptInput): Promise<PaymentAttemptResult> {
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

      // 3. Inspect existing active pending Payment
      const activeAttempt = await Payment.findOne({
        where: { order_id: order.id, status: "pending" },
        transaction
      });

      if (activeAttempt) {
        throw new PaymentAttemptAlreadyActiveError(order.id);
      }

      // 4. Allocate ID for Payment
      const paymentId = await IdSequenceService.allocateNextId("payments", transaction);

      // 5. Snapshot amount/currency and create the new Payment Attempt
      // provider is "payu" as selected, provider IDs and payload remain null
      const payment = await Payment.create(
        {
          id: paymentId,
          order_id: order.id,
          amount: order.total,
          currency: order.currency,
          provider: "payu",
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
  async getOrCreateActiveAttempt(orderId: number): Promise<PaymentAttemptResult> {
    try {
      return await this.createPaymentAttempt({ orderId });
    } catch (error) {
      if (error instanceof PaymentAttemptAlreadyActiveError) {
        const existing = await Payment.findOne({ where: { order_id: orderId, status: "pending" } });
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
      payment.provider_order_id = generatePayuTxnId(payment.id);
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

    const attempt = await this.getOrCreateActiveAttempt(order.id);
    const attemptWithTxnId = await this.ensureProviderTransactionId(attempt.id);

    const items = await OrderItem.findAll({ where: { order_id: order.id }, order: [["id", "ASC"]], limit: 1 });
    const productinfo = itemCount === 1 && items[0] ? items[0].product_name : `MyPetMart Order ${order.order_number} (${itemCount} items)`;

    return this.buildHostedCheckoutFields(order, attemptWithTxnId, productinfo);
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

    if (payment.status === "pending" && payment.provider_order_id) {
      try {
        const raw = await PayuVerifyClient.verifyPayment(payment.provider_order_id);
        const normalized = normalizeVerifyApiResult(payment.provider_order_id, raw);
        await PaymentFinalizationService.processVerifiedPaymentResult(normalized);
      } catch (error) {
        logger.warn({ err: error, paymentAttemptId: payment.id, orderId: order.id }, "payment status: Verify Payment API reconciliation failed, returning last-known local state");
      }
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
  }
};
