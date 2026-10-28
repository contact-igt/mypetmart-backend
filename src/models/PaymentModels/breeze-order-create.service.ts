import { Op, UniqueConstraintError } from "sequelize";
import { z } from "zod";

import { paymentConfig } from "../../config/payment.config.js";
import { DATABASE_TABLE_NAMES, DEFAULT_COUNTRY_CODE, DEFAULT_CURRENCY_CODE } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { BreezeCheckoutSession, BreezeWebhookEvent, Order, OrderItem, Payment, User } from "../../database/tables/index.js";
import { logger } from "../../utils/logger.js";
import { formatPaiseAsMoney } from "../../utils/product-money.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import type { CartIdentity } from "../CartModels/cart.types.js";
import { CartService } from "../CartModels/cart.service.js";
import { updateOrderShippingAddressSchema } from "../OrderModels/order.validation.js";
import { isValidOrderStatusTransition } from "../OrderModels/order.constants.js";
import { resolveCartPaymentMethods } from "../ProductModels/product-payment-methods.js";
import { ServiceabilityService } from "../ShipmentModels/serviceability.service.js";
import { fromProviderAmount } from "./breeze-money.js";
import type { BreezeOrderIntent } from "./breeze-order-intent.js";
import { classifyBreezeStatus, BREEZE_ORDER_CREATE_EVENT_NAMES, type BreezeOrderCreatePayload } from "./breeze-order-create.schema.js";
import { PaymentFinalizationService, lockAndCheckOrderStock } from "./payment-finalization.service.js";
import { raiseBreezeAlert } from "./breeze-alerts.service.js";
import type { NormalizedPaymentResult } from "./payment.types.js";

// ---------------------------------------------------------------------------
// Breeze Full 1CCO "Order Create Webhook" bridge.
//
//   authenticated, schema-validated webhook
//     -> event row (idempotency + evidence)            [short txn]
//     -> session lookup by content.cart.id             (== our public_id)
//     -> money/currency/COD/address verification       (no DB lock, no network)
//     -> serviceability lookup                         (network, outside any txn)
//     -> PHASE 1: lock session, create-or-reuse Order + OrderItems + Payment
//                 from the IMMUTABLE order_intent      [one txn, committed]
//     -> PHASE 2: PaymentFinalizationService.processVerifiedPaymentResult
//                 (its own txn; stock/coupon/cart handled there, once)
//     -> PHASE 3: persist session + event result, return the documented ack
//
// If phase 1 commits but phase 2 fails, the event stays "received" and Breeze's
// retry (or replayStoredEvent) re-enters at phase 1, which reuses the Order and
// Payment, then re-runs phase 2 — never a second Order.
// ---------------------------------------------------------------------------

export type BreezeWebhookAck = { httpStatus: number; body: Record<string, unknown> };

const PROVIDER_REFERENCE_PREFIX = "BRZC-";

/**
 * JSON columns come back parsed from MySQL but as TEXT from MariaDB (JSON is a
 * LONGTEXT alias there); accept both so behaviour never depends on the server.
 */
function readJson<T>(value: unknown): T | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }
  return value as T;
}

function providerOrderRef(sessionPublicId: string): string {
  return `${PROVIDER_REFERENCE_PREFIX}${sessionPublicId}`;
}

function okAck(eventId: string, status: string, message: string, orderNumber?: string): BreezeWebhookAck {
  return { httpStatus: 200, body: { id: eventId, status, message, ...(orderNumber ? { content: { orderId: orderNumber } } : {}) } };
}

function failAck(httpStatus: number, eventId: string, message: string): BreezeWebhookAck {
  return { httpStatus, body: { id: eventId, status: "FAILED", message } };
}

type ProcessOutcome = {
  ack: BreezeWebhookAck;
  eventStatus: "processed" | "ignored" | "reconciliation_required";
  outcomeCode: string;
  // false => leave the event "received" so a retry re-enters (transient).
  terminal: boolean;
};

const emailSchema = z.string().email().max(255);

function mapShippingAddress(payload: BreezeOrderCreatePayload) {
  const address = payload.content.shippingAddress;
  const countryCode = address.countryCode?.trim() ?? "";
  const phone = countryCode ? `${countryCode} ${address.phoneNumber}`.trim() : address.phoneNumber;
  const parsed = updateOrderShippingAddressSchema.safeParse({
    recipientName: address.name,
    phone,
    line1: address.line1,
    ...(address.line2 ? { line2: address.line2 } : {}),
    city: address.city,
    state: address.state,
    postalCode: address.postalCode
  });
  if (!parsed.success) return null;
  if (address.country.trim().toUpperCase() !== DEFAULT_COUNTRY_CODE) return null;
  return { ...parsed.data, country: DEFAULT_COUNTRY_CODE };
}

function looksLikeCod(payload: BreezeOrderCreatePayload): boolean {
  const { paymentMethod, paymentMethodType } = payload.content.payment;
  return /\bCOD\b|CASH/iu.test(`${paymentMethod} ${paymentMethodType}`);
}

async function claimEvent(payload: BreezeOrderCreatePayload, alreadyCountedAttempt: boolean): Promise<BreezeWebhookEvent> {
  const existing = await BreezeWebhookEvent.findOne({ where: { event_kind: "order_create", event_id: payload.id } });
  if (existing) {
    // The reconciliation sweep records its own attempt when it claims the row,
    // so it must not be counted twice here.
    if (!alreadyCountedAttempt) {
      existing.attempts += 1;
      await existing.save();
    }
    return existing;
  }
  try {
    return await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.breezeWebhookEvents, t);
      return BreezeWebhookEvent.create(
        {
          id,
          event_id: payload.id,
          event_kind: "order_create",
          event_name: payload.eventName.slice(0, 80),
          session_public_id: payload.content.cart.id.slice(0, 64),
          outcome_code: null,
          http_status: null,
          response_body: null,
          payload
        },
        { transaction: t }
      );
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      // A concurrent delivery of the same event won the insert.
      const winner = await BreezeWebhookEvent.findOne({ where: { event_kind: "order_create", event_id: payload.id } });
      if (winner) return winner;
    }
    throw error;
  }
}

async function finishEvent(event: BreezeWebhookEvent, outcome: ProcessOutcome): Promise<void> {
  if (!outcome.terminal) {
    event.outcome_code = outcome.outcomeCode;
    await event.save();
    return;
  }
  event.status = outcome.eventStatus;
  event.outcome_code = outcome.outcomeCode;
  event.http_status = outcome.ack.httpStatus;
  event.response_body = outcome.ack.body;
  await event.save();
}

async function markSession(publicId: string, fields: { processing_status?: "awaiting_webhook" | "order_created" | "finalized" | "reconciliation_required" | "failed"; last_error_code?: string | null; last_event_id?: string }): Promise<void> {
  await BreezeCheckoutSession.update(fields, { where: { public_id: publicId } });
}

/**
 * Stores Breeze's distinct references on the session. They are unique across
 * sessions, so a reference already attached to a DIFFERENT session is a
 * conflict; so is a different reference arriving after an Order already exists.
 */
async function recordProviderReferences(sessionId: number, payload: BreezeOrderCreatePayload): Promise<"ok" | "conflict"> {
  const { orderId, txnId, cart } = payload.content;
  try {
    return await sequelize.transaction(async (t) => {
      const session = await BreezeCheckoutSession.findByPk(sessionId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!session) return "conflict";
      // Once an Order exists for this checkout, a different Breeze order or
      // transaction id would be a second, separate payment event: never merge
      // it silently. Before an Order exists (pending/failed attempts, retries)
      // the latest references simply replace the earlier ones.
      if (session.order_id !== null) {
        if (session.breeze_order_id && session.breeze_order_id !== orderId) return "conflict";
        if (txnId && session.breeze_txn_id && session.breeze_txn_id !== txnId) return "conflict";
      }
      session.breeze_cart_id = cart.breezeCartId;
      session.breeze_order_id = orderId;
      if (txnId) session.breeze_txn_id = txnId;
      session.last_event_id = payload.id;
      await session.save({ transaction: t });
      return "ok" as const;
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) return "conflict";
    throw error;
  }
}

type CreatedOrder = { orderId: number; orderNumber: string; paymentId: number; reused: boolean };
type CheckoutPaymentKind = "breeze" | "cod";

/** PHASE 1 — create-or-reuse the Order, OrderItems and Payment under the session lock. */
async function ensureOrderAndPayment(
  sessionId: number,
  intent: BreezeOrderIntent,
  shipping: NonNullable<ReturnType<typeof mapShippingAddress>>,
  guestEmail: string | null,
  paymentKind: CheckoutPaymentKind
): Promise<CreatedOrder> {
  return sequelize.transaction(async (t) => {
    const session = await BreezeCheckoutSession.findByPk(sessionId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!session) throw new Error(`Breeze checkout session '${sessionId}' disappeared.`);

    if (session.order_id !== null && session.payment_id !== null) {
      const existingOrder = await Order.findByPk(session.order_id, { transaction: t });
      if (!existingOrder) throw new Error(`Session '${session.public_id}' references missing Order '${session.order_id}'.`);
      return { orderId: existingOrder.id, orderNumber: existingOrder.order_number, paymentId: session.payment_id, reused: true };
    }

    let contactEmail: string | null = guestEmail;
    if (session.user_id !== null) {
      const user = await User.findByPk(session.user_id, { transaction: t });
      contactEmail = user ? user.email : null;
    }

    const orderId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.orders, t);
    const orderNumberId = await IdSequenceService.allocateNextId("order_numbers", t);
    const orderNumber = buildBusinessReference("order", orderNumberId);
    const isGuest = session.user_id === null;

    const order = await Order.create(
      {
        id: orderId,
        order_number: orderNumber,
        user_id: session.user_id,
        guest_identity_hash: isGuest ? session.guest_identity_hash : null,
        // No recovery token is issued for webhook-created guest Orders (the browser
        // never receives a raw token from Breeze). Recovery is via the owning cart.
        guest_access_token_hash: null,
        cart_id: session.cart_id,
        status: "pending",
        payment_status: "pending",
        fulfilment_status: "unfulfilled",
        subtotal: formatPaiseAsMoney(intent.subtotalPaise),
        shipping_fee: formatPaiseAsMoney(intent.shippingFeePaise),
        total: formatPaiseAsMoney(intent.totalPaise),
        // The Breeze cart carries no coupon and no Pay Online discount (the
        // session API rejects coupon carts) — snapshots are explicitly empty.
        coupon_id: null,
        coupon_code_snapshot: null,
        coupon_discount_type_snapshot: null,
        coupon_discount_value_snapshot: null,
        coupon_eligible_merchandise_paise: null,
        coupon_discount_amount_paise: 0,
        online_payment_discount_type_snapshot: null,
        online_payment_discount_value_snapshot: null,
        online_payment_discount_amount_paise: 0,
        currency: DEFAULT_CURRENCY_CODE,
        contact_email: contactEmail,
        ship_recipient_name: shipping.recipientName,
        ship_phone: shipping.phone,
        ship_line_1: shipping.line1,
        ship_line_2: shipping.line2 ?? null,
        ship_city: shipping.city,
        ship_state: shipping.state,
        ship_postal_code: shipping.postalCode,
        ship_country: shipping.country,
        ship_latitude: null,
        ship_longitude: null
      } as never,
      { transaction: t }
    );

    const itemIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.orderItems, intent.lines.length, t);
    for (let index = 0; index < intent.lines.length; index++) {
      const line = intent.lines[index]!;
      await OrderItem.create(
        {
          id: itemIds[index]!,
          order_id: order.id,
          product_id: line.productId,
          product_variant_id: line.variantId,
          product_name: line.productName,
          product_sku: line.productSku,
          variant_name: line.variantName,
          variant_sku: line.variantSku,
          product_image: line.productImage,
          quantity: line.quantity,
          unit_price: formatPaiseAsMoney(line.unitPricePaise),
          line_total: formatPaiseAsMoney(line.unitPricePaise * line.quantity),
          discount_allocated_paise: 0,
          online_payment_discount_allocated_paise: 0,
          product_payment_method_eligibility_snapshot: line.paymentMethodEligibility
        },
        { transaction: t }
      );
    }

    const paymentId = await IdSequenceService.allocateNextId("payments", t);
    await Payment.create(
      {
        id: paymentId,
        order_id: order.id,
        amount: order.total,
        currency: order.currency,
        provider: paymentKind,
        status: "pending",
        provider_order_id: paymentKind === "breeze" ? providerOrderRef(session.public_id) : null,
        provider_payment_id: null,
        method: paymentKind === "cod" ? "cod" : null,
        raw_payload: { provider: "breeze", flow: "full_1cco", sessionPublicId: session.public_id, paymentKind }
      },
      { transaction: t }
    );

    session.order_id = order.id;
    session.payment_id = paymentId;
    session.processing_status = "order_created";
    await session.save({ transaction: t });

    return { orderId: order.id, orderNumber, paymentId, reused: false };
  });
}

/** Confirms a Breeze-originated COD order without ever marking its payment paid. */
async function finalizeBreezeCodOrder(orderId: number, paymentId: number): Promise<"SUCCESS_CONFIRMED" | "NOOP_ALREADY_TERMINAL" | "STOCK_UNAVAILABLE"> {
  return sequelize.transaction(async (t) => {
    const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
    const payment = await Payment.findByPk(paymentId, { transaction: t, lock: t.LOCK.UPDATE });
    if (!order || !payment || payment.order_id !== orderId || payment.provider !== "cod" || payment.status !== "pending") {
      return "STOCK_UNAVAILABLE";
    }
    if (order.status === "confirmed") return "NOOP_ALREADY_TERMINAL";
    if (!isValidOrderStatusTransition(order.status, "confirmed")) return "STOCK_UNAVAILABLE";

    const lines = await lockAndCheckOrderStock(order.id, t);
    if (!lines) return "STOCK_UNAVAILABLE";
    for (const line of lines) {
      if (line.variant) {
        line.variant.stock = line.availableStock - line.item.quantity;
        await line.variant.save({ transaction: t });
      } else {
        line.product.stock = line.availableStock - line.item.quantity;
        await line.product.save({ transaction: t });
      }
    }
    order.status = "confirmed";
    await order.save({ transaction: t });
    await CartService.finalizeCartForOrder(order, t);
    return "SUCCESS_CONFIRMED";
  });
}

function reconcile(payload: BreezeOrderCreatePayload, code: string, httpStatus: number, message: string): ProcessOutcome {
  return { ack: failAck(httpStatus, payload.id, message), eventStatus: "reconciliation_required", outcomeCode: code, terminal: true };
}

async function processEvent(payload: BreezeOrderCreatePayload): Promise<ProcessOutcome> {
  const { content } = payload;

  // 1. Only the documented event name is an order-create event.
  if (!(BREEZE_ORDER_CREATE_EVENT_NAMES as readonly string[]).includes(payload.eventName)) {
    return { ack: okAck(payload.id, "PENDING", "Event ignored"), eventStatus: "ignored", outcomeCode: "UNSUPPORTED_EVENT", terminal: true };
  }

  // 2. Correlate to the checkout session via the merchant cart id we signed.
  const session = await BreezeCheckoutSession.findOne({ where: { public_id: content.cart.id } });
  if (!session) {
    return reconcile(payload, "UNKNOWN_SESSION", 422, "Unknown merchant cart reference.");
  }

  const statusClass = classifyBreezeStatus(payload.eventName, content.status);
  await markSession(session.public_id, { last_event_id: payload.id });

  // 3. Non-financial / non-success classes never create an Order.
  if (statusClass === "unpaid_pending") {
    return { ack: okAck(payload.id, "PENDING", "Recorded; awaiting payment"), eventStatus: "processed", outcomeCode: "PENDING_RECORDED", terminal: true };
  }
  if (statusClass === "unknown") {
    return { ack: okAck(payload.id, "PENDING", "Status not recognised; recorded for reconciliation"), eventStatus: "reconciliation_required", outcomeCode: "UNKNOWN_STATUS", terminal: true };
  }
  if (statusClass === "partial") {
    await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: "PARTIAL_PAYMENT_UNSUPPORTED" });
    return reconcile(payload, "PARTIAL_PAYMENT_UNSUPPORTED", 422, "Partial payments are not supported; recorded for reconciliation.");
  }
  if (statusClass === "refund") {
    // Refunds are managed by Breeze (no refund API). Recorded only — never
    // routed to PayU refund logic and never mutates local financial state.
    const order = session.order_id !== null ? await Order.findByPk(session.order_id) : null;
    return {
      ack: okAck(payload.id, content.status ?? "PENDING", "Refund event recorded for reconciliation", order?.order_number),
      eventStatus: "reconciliation_required",
      outcomeCode: "PROVIDER_REFUND_REPORTED",
      terminal: true
    };
  }

  const failedClass = statusClass === "failed";

  // 5. Provider references: distinct fields, unique across sessions.
  const refResult = await recordProviderReferences(session.id, payload);
  if (refResult === "conflict") {
    await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: "PROVIDER_REFERENCE_CONFLICT" });
    await raiseBreezeAlert("provider_reference_conflict", session.public_id, { sessionId: session.id, eventId: payload.id });
    return reconcile(payload, "PROVIDER_REFERENCE_CONFLICT", 409, "Conflicting provider references.");
  }

  // 6. Failure-class: no Order is created. An existing pending Payment is
  //    failed through the shared finalizer (which never overrides a paid one).
  if (failedClass) {
    if (session.order_id === null) {
      await markSession(session.public_id, { processing_status: "failed" });
      return { ack: okAck(payload.id, content.status ?? "FAILED", "Recorded; no order created"), eventStatus: "processed", outcomeCode: "FAILURE_RECORDED_NO_ORDER", terminal: true };
    }
    const failure: NormalizedPaymentResult = {
      merchantTransactionId: providerOrderRef(session.public_id),
      providerPaymentId: null,
      providerStatus: content.status ?? payload.eventName,
      normalizedOutcome: content.status?.toUpperCase() === "FAILED" ? "FAILED" : "CANCELLED",
      amount: formatPaiseAsMoney(session.amount_paise),
      method: null,
      verifiedAt: new Date(),
      verifiedVia: "webhook",
      safeMetadata: { provider: "breeze", eventName: payload.eventName, breezeOrderId: content.orderId }
    };
    const outcome = await PaymentFinalizationService.processVerifiedPaymentResult(failure);
    const order = await Order.findByPk(session.order_id);
    return { ack: okAck(payload.id, content.status ?? "FAILED", `Recorded (${outcome.code})`, order?.order_number), eventStatus: "processed", outcomeCode: `FAILURE_${outcome.code}`, terminal: true };
  }

  // 4. Money is unit-ambiguous in the Breeze docs: no financial processing
  //    until BREEZE_AMOUNT_UNIT is configured. The authenticated event is kept
  //    ("received") so it can be replayed once the unit is confirmed.
  const unit = paymentConfig.breezeAmountUnit;
  if (!unit) {
    return { ack: failAck(503, payload.id, "Temporarily unable to process."), eventStatus: "reconciliation_required", outcomeCode: "AMOUNT_UNIT_NOT_CONFIGURED", terminal: false };
  }

  // ---- paid class from here ----

  // 7. Currency and amount: session quote == cart total == payment amount.
  if (content.payment.currency.toUpperCase() !== DEFAULT_CURRENCY_CODE || content.cart.currency.toUpperCase() !== DEFAULT_CURRENCY_CODE) {
    await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: "CURRENCY_MISMATCH" });
    await raiseBreezeAlert("amount_or_currency_mismatch", payload.id, { eventId: payload.id, outcomeCode: "CURRENCY_MISMATCH", errorCode: "CURRENCY_MISMATCH" });
    return reconcile(payload, "CURRENCY_MISMATCH", 422, "Unsupported currency.");
  }
  const isCod = looksLikeCod(payload);
  // Breeze's COD callback reports payment.amount in rupees while the signed
  // cart total remains in the configured cart unit. COD collects no money at
  // checkout, so authorize its order against the signed cart total only.
  const paidPaise = fromProviderAmount(content.payment.amount, isCod ? "rupees" : unit);
  const cartPaise = fromProviderAmount(content.cart.totalPrice, unit);
  if (cartPaise === null || cartPaise !== session.amount_paise || (!isCod && (paidPaise === null || paidPaise !== session.amount_paise))) {
    logger.warn(
      {
        sessionPublicId: session.public_id,
        configuredAmountUnit: unit,
        expectedAmountPaise: session.amount_paise,
        paymentAmount: content.payment.amount,
        cartTotalPrice: content.cart.totalPrice,
        paymentAmountPaise: paidPaise,
        cartTotalPricePaise: cartPaise
      },
      "breeze order-create webhook: amount mismatch"
    );
    await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: "AMOUNT_MISMATCH" });
    await raiseBreezeAlert("amount_or_currency_mismatch", payload.id, { eventId: payload.id, outcomeCode: "AMOUNT_MISMATCH", errorCode: "AMOUNT_MISMATCH" });
    return reconcile(payload, "AMOUNT_MISMATCH", 422, "Amount does not match the authorised checkout.");
  }

  // 9. Immutable intent + address (only needed to create the Order).
  const intent = readJson<BreezeOrderIntent>(session.order_intent);
  if (session.order_id === null && (!intent || intent.version !== 1 || intent.lines.length === 0 || intent.totalPaise !== session.amount_paise)) {
    await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: "MISSING_ORDER_INTENT" });
    return reconcile(payload, "MISSING_ORDER_INTENT", 422, "Checkout snapshot unavailable.");
  }
  const shipping = mapShippingAddress(payload);
  if (session.order_id === null && !shipping) {
    await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: "INVALID_SHIPPING_ADDRESS" });
    return reconcile(payload, "INVALID_SHIPPING_ADDRESS", 422, "Shipping address is not valid for delivery.");
  }

  if (isCod) {
    const methods = resolveCartPaymentMethods(intent!.lines.map((line) => ({ productId: line.productId, productName: line.productName, eligibility: line.paymentMethodEligibility })));
    if (!methods.allowedPaymentMethods.includes("cod")) {
      await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: "COD_PAYMENT_METHOD_NOT_ALLOWED" });
      return reconcile(payload, "COD_PAYMENT_METHOD_NOT_ALLOWED", 422, "Cash on Delivery is not available for one or more items in this checkout.");
    }
  }

  // 10. Serviceability — a network lookup, deliberately outside any DB
  //     transaction. Captured money is never rejected for it; an explicit "not
  //     serviceable" is flagged on the session for support.
  let unserviceable = false;
  if (session.order_id === null && shipping) {
    try {
      unserviceable = !(await ServiceabilityService.checkDestination(shipping.postalCode, isCod ? "cod" : "prepaid"));
    } catch {
      unserviceable = false; // lookup unavailable: unknown, not a rejection
    }
  }

  if (isCod && unserviceable) {
    await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: "COD_DESTINATION_UNSERVICEABLE" });
    return reconcile(payload, "COD_DESTINATION_UNSERVICEABLE", 422, "Cash on Delivery is not available for this delivery address.");
  }

  const guestEmailCandidate = emailSchema.safeParse(content.customer.emailAddress ?? content.shippingAddress.emailAddress ?? "");
  const guestEmail = guestEmailCandidate.success ? guestEmailCandidate.data : null;

  // PHASE 1
  // (When the session already has an Order, ensureOrderAndPayment returns it
  // before touching intent/shipping, so a replay needs neither.)
  const created: CreatedOrder = await ensureOrderAndPayment(session.id, intent as BreezeOrderIntent, shipping as NonNullable<typeof shipping>, guestEmail, isCod ? "cod" : "breeze");

  if (isCod) {
    const codFinalization = await finalizeBreezeCodOrder(created.orderId, created.paymentId);
    if (codFinalization !== "SUCCESS_CONFIRMED" && codFinalization !== "NOOP_ALREADY_TERMINAL") {
      await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: codFinalization });
      return reconcile(payload, `COD_${codFinalization}`, 422, "Cash on Delivery order could not be confirmed.");
    }
    if (codFinalization === "SUCCESS_CONFIRMED") {
      await CommerceNotifications.codOrderConfirmed(created.orderId);
    }
    await markSession(session.public_id, { processing_status: "finalized", last_error_code: null });
    await BreezeCheckoutSession.update({ status: "completed" }, { where: { public_id: session.public_id } });
    return {
      ack: okAck(payload.id, "SUCCESS", "Cash on Delivery order created successfully", created.orderNumber),
      eventStatus: "processed",
      outcomeCode: codFinalization,
      terminal: true
    };
  }

  // PHASE 2 — the single shared finalization path.
  const result: NormalizedPaymentResult = {
    merchantTransactionId: providerOrderRef(session.public_id),
    providerPaymentId: (content.txnId ?? content.orderId).slice(0, 190),
    providerStatus: content.status ?? payload.eventName,
    normalizedOutcome: "SUCCESS",
    // Exact integer-paise formatting (never float division).
    amount: formatPaiseAsMoney(paidPaise!),
    method: (content.payment.paymentMethodType || content.payment.paymentMethod).slice(0, 80),
    verifiedAt: new Date(),
    verifiedVia: "webhook",
    safeMetadata: {
      provider: "breeze",
      eventName: payload.eventName,
      breezeStatus: content.status ?? null,
      breezeOrderId: content.orderId,
      breezeTxnId: content.txnId ?? null,
      breezeCartId: content.cart.breezeCartId,
      paymentMethod: content.payment.paymentMethod,
      currency: content.payment.currency
    }
  };
  const finalization = await PaymentFinalizationService.processVerifiedPaymentResult(result);

  // PHASE 3
  const accepted = finalization.code === "SUCCESS_CONFIRMED" || finalization.code === "SUCCESS_COMMERCE_EXCEPTION" || finalization.code === "NOOP_ALREADY_TERMINAL";
  if (!accepted) {
    await markSession(session.public_id, { processing_status: "reconciliation_required", last_error_code: finalization.code });
    return reconcile(payload, `FINALIZATION_${finalization.code}`, 422, "Payment could not be reconciled.");
  }
  if (finalization.code === "SUCCESS_COMMERCE_EXCEPTION") {
    // Money is captured but the order cannot be fulfilled: this needs a human now.
    await raiseBreezeAlert("captured_with_commerce_exception", String(created.orderId), { orderId: created.orderId, paymentId: created.paymentId, outcomeCode: finalization.code });
  }
  await markSession(session.public_id, { processing_status: "finalized", last_error_code: unserviceable ? "DESTINATION_UNSERVICEABLE" : null });
  await BreezeCheckoutSession.update({ status: "completed" }, { where: { public_id: session.public_id } });

  return {
    ack: okAck(payload.id, "SUCCESS", "Order created successfully", created.orderNumber),
    eventStatus: "processed",
    outcomeCode: unserviceable ? `${finalization.code}_UNSERVICEABLE` : finalization.code,
    terminal: true
  };
}

export const BreezeOrderCreateService = {
  /** Handles one authenticated, schema-validated Order Create webhook. */
  async handle(payload: BreezeOrderCreatePayload, options: { alreadyCountedAttempt?: boolean } = {}): Promise<BreezeWebhookAck> {
    const event = await claimEvent(payload, options.alreadyCountedAttempt === true);

    // Replay of an event we already answered conclusively: same answer, no work.
    if ((event.status === "processed" || event.status === "ignored") && event.response_body && event.http_status !== null) {
      const stored = readJson<Record<string, unknown>>(event.response_body);
      if (stored) return { httpStatus: event.http_status, body: stored };
    }

    const outcome = await processEvent(payload);
    await finishEvent(event, outcome);
    logger.info({ eventStatus: outcome.eventStatus, outcomeCode: outcome.outcomeCode, httpStatus: outcome.ack.httpStatus }, "breeze order-create webhook: handled");
    return outcome.ack;
  },

  /** Re-runs a stored event (e.g. after BREEZE_AMOUNT_UNIT is configured). */
  async replayStoredEvent(eventId: string): Promise<BreezeWebhookAck | null> {
    const event = await BreezeWebhookEvent.findOne({ where: { event_kind: "order_create", event_id: eventId, status: { [Op.in]: ["received", "reconciliation_required"] } } });
    if (!event) return null;
    const stored = readJson<BreezeOrderCreatePayload>(event.payload);
    return stored ? this.handle(stored) : null;
  },

  /**
   * Server-confirmed state for the browser. Ownership is checked against the
   * identity that created the session; browser SDK events are never consulted.
   */
  async getSessionStatus(identity: CartIdentity, sessionPublicId: string) {
    const session = await BreezeCheckoutSession.findOne({ where: { public_id: sessionPublicId } });
    const owns =
      session !== null &&
      (identity.type === "customer" ? session.user_id === identity.userId : session.user_id === null && session.guest_identity_hash === identity.tokenHash);
    if (!session || !owns) return null;

    const base = { sessionId: session.public_id, processingStatus: session.processing_status, awaitingWebhook: session.order_id === null, order: null as null | Record<string, unknown>, guestAccessToken: null as string | null };
    if (session.order_id === null) return base;

    const order = await Order.findByPk(session.order_id);
    if (!order) return base;

    // No guest recovery token is minted or rotated here. Rotating on every read
    // would silently revoke a recovery link the guest already holds, and this
    // endpoint is already authorised by the owning cart identity.
    return {
      ...base,
      order: { id: order.id, orderNumber: order.order_number, status: order.status, paymentStatus: order.payment_status, commerceException: order.commerce_exception }
    };
  }
};
