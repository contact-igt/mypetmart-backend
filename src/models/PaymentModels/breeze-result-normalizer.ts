import type { NormalizedPaymentOutcome, NormalizedPaymentResult } from "./payment.types.js";
import type { BreezeWebhookPayload } from "./breeze.types.js";

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

function statusSignal(payload: BreezeWebhookPayload): string {
  const data = payload.data ?? {};
  return (
    firstString(payload.status, data.status, payload.event, data.event, payload.event_type, data.event_type, payload.type, data.type) ?? ""
  );
}

function mapBreezeOutcome(signal: string): NormalizedPaymentOutcome {
  const normalized = signal.trim().toLowerCase().replace(/[\s-]+/gu, "_");
  switch (normalized) {
    case "success":
    case "succeeded":
    case "charged":
    case "captured":
    case "payment_success":
    case "payment_succeeded":
    case "order_succeeded":
      return "SUCCESS";
    case "failure":
    case "failed":
    case "declined":
    case "payment_failed":
    case "order_failed":
      return "FAILED";
    case "cancelled":
    case "canceled":
    case "user_cancelled":
    case "user_canceled":
    case "payment_cancelled":
    case "payment_canceled":
    case "order_cancelled":
    case "order_canceled":
      return "CANCELLED";
    case "pending":
    case "initiated":
    case "processing":
    case "payment_pending":
      return "PENDING";
    default:
      return "PENDING";
  }
}

export function normalizeBreezeWebhookResult(payload: BreezeWebhookPayload): NormalizedPaymentResult {
  const data = payload.data ?? {};
  const merchantTransactionId =
    firstString(
      payload.merchant_transaction_id,
      payload.merchantTransactionId,
      data.merchant_transaction_id,
      data.merchantTransactionId,
      payload.merchant_order_id,
      payload.merchantOrderId,
      data.merchant_order_id,
      data.merchantOrderId,
      payload.order_id,
      payload.orderId,
      data.order_id,
      data.orderId
    ) ?? "";
  const providerPaymentId = firstString(payload.transaction_id, payload.transactionId, data.transaction_id, data.transactionId, payload.payment_id, payload.paymentId, data.payment_id, data.paymentId);
  const providerStatus = statusSignal(payload);
  const method = firstString(payload.payment_method, payload.method, data.payment_method, data.method);
  const eventType = firstString(payload.event, payload.event_type, payload.type, data.event, data.event_type, data.type);

  return {
    merchantTransactionId,
    providerPaymentId,
    providerStatus,
    normalizedOutcome: mapBreezeOutcome(providerStatus),
    amount: amountString(payload.amount ?? data.amount),
    method,
    verifiedAt: new Date(),
    verifiedVia: "webhook",
    safeMetadata: {
      provider: "breeze",
      eventType,
      environment: firstString(payload.environment, data.environment),
      paymentMethod: method
    }
  };
}
