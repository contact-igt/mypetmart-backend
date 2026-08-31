import type { NormalizedPaymentOutcome, NormalizedPaymentResult } from "./payment.types.js";
import type { BreezeWebhookContent, BreezeWebhookPayload } from "./breeze.types.js";

// Turns the documented Breeze "Order Create Webhook" body into the single
// NormalizedPaymentResult shape PaymentFinalizationService already consumes
// (the exact same convergence point PayU's webhook + Verify API use).
//
// Documented body: { id, eventName, content: { orderId, txnId?, status,
//   payment: { paymentMethod, paymentMethodType, amount, currency }, ... } }
//
// Status mapping uses only the documented OrderStatus vocabulary
// (docs.breeze.in -> "Order Status") plus the documented top-level eventName
// example `ORDER_SUCCEEDED`. Anything not clearly a terminal signal maps to
// PENDING — never guessed as FAILED/CANCELLED without clear evidence, matching
// the existing PayU normalizer's rule.

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return null;
}

function amountString(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return "0.00";
}

function mapBreezeOutcome(signal: string): NormalizedPaymentOutcome {
  const normalized = signal.trim().toUpperCase().replace(/[\s-]+/gu, "_");
  switch (normalized) {
    case "SUCCESS":
    case "ORDER_SUCCEEDED":
    case "PAYMENT_SUCCESS":
    case "PAID":
      return "SUCCESS";
    case "FAILED":
    case "FAILURE":
    case "ORDER_FAILED":
    case "PAYMENT_FAILED":
      return "FAILED";
    case "CANCELLED":
    case "CANCELED":
    case "ORDER_CANCELLED":
    case "PAYMENT_CANCELLED":
      return "CANCELLED";
    case "PENDING":
    case "PARTIALLY_PAID": // treat partial as not-yet-final; never auto-confirm
    case "PROCESSING":
      return "PENDING";
    default:
      return "PENDING";
  }
}

function content(payload: BreezeWebhookPayload): BreezeWebhookContent {
  return payload.content ?? payload.eventData ?? payload.data ?? {};
}

export function normalizeBreezeWebhookResult(payload: BreezeWebhookPayload): NormalizedPaymentResult {
  const c = content(payload);
  const payment = c.payment ?? {};

  // TODO — BREEZE CONFIRMATION REQUIRED: which of these is the reference we
  // sent as startPayment.orderId (== Payment.provider_order_id). Tried in
  // order; an unmatched value is safely rejected downstream with no mutation.
  const merchantTransactionId = firstString(c.txnId, c.orderId, c.cart?.id, c.cart?.breezeCartId) ?? "";

  const providerPaymentId = firstString(c.txnId, c.orderId, payload.id);
  const statusSignal = firstString(c.status, payload.eventName) ?? "";
  const method = firstString(payment.paymentMethod, payment.paymentMethodType);

  // TODO — BREEZE CONFIRMATION REQUIRED: the unit of content.payment.amount.
  // The docs' PaymentDetail example shows `amount: 10, currency: INR` while
  // the cart example uses `totalPrice: 500.00` (decimal rupees). This
  // normalizer assumes DECIMAL RUPEES (matching Payment.amount). If Breeze
  // actually sends paise, PaymentFinalizationService's amount check will
  // reject the webhook without mutation (a safe failure) until this is fixed.

  return {
    merchantTransactionId,
    providerPaymentId,
    providerStatus: statusSignal,
    normalizedOutcome: mapBreezeOutcome(statusSignal),
    amount: amountString(payment.amount ?? c.cart?.totalPrice),
    method,
    verifiedAt: new Date(),
    verifiedVia: "webhook",
    safeMetadata: {
      provider: "breeze",
      eventName: firstString(payload.eventName),
      breezeOrderId: firstString(c.orderId),
      breezeTxnId: firstString(c.txnId),
      paymentMethod: method,
      currency: firstString(payment.currency)
    }
  };
}
