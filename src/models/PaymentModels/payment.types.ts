import type { Payment } from "../../database/tables/PaymentTable/index.js";

export type CreatePaymentAttemptInput = {
  orderId: number;
};

// Return type for internal service usage, no public JSON DTOs yet as per requirements
export type PaymentAttemptResult = Payment;

// ---------------------------------------------------------------------------
// Payment Initiation (PayU Hosted Checkout)
// ---------------------------------------------------------------------------

// Exactly one of the two is present — enforced by initiatePaymentSchema's Zod
// refine, and re-checked against the resolved caller identity in the service
// (a customer must supply orderId; a guest must supply guestAccessToken).
export type InitiatePaymentInput = {
  orderId?: number;
  guestAccessToken?: string;
};

export type PaymentInitiationCaller = { type: "customer"; userId: number } | { type: "guest" };

// The safe, server-authoritative fields the storefront auto-submits as a
// browser form POST directly to gatewayUrl. Never includes the PayU merchant
// salt or any other secret.
export type PayuHostedCheckoutFieldsJSON = {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  phone: string;
  surl: string;
  furl: string;
  udf1: string;
  hash: string;
  service_provider?: string;
};

export type PaymentInitiationResultJSON = {
  provider: "payu";
  gatewayUrl: string;
  fields: PayuHostedCheckoutFieldsJSON;
};

// ---------------------------------------------------------------------------
// Verified Payment Result (webhook / Verify Payment API convergence point)
// ---------------------------------------------------------------------------

// PENDING covers both a genuinely async/uncertain provider state and any
// result this codebase cannot yet confidently map (see
// payu-result-normalizer.ts) — never invented as FAILED/CANCELLED without
// clear provider evidence. CANCELLED is defined for forward-compatibility
// but is not reachable from PayU's currently-documented webhook/Verify
// Payment API status vocabulary (success/failure/pending only).
export type NormalizedPaymentOutcome = "SUCCESS" | "FAILED" | "CANCELLED" | "PENDING";

// The single shared shape both the webhook path and the Verify Payment API
// path normalize into before ever reaching PaymentFinalizationService. Only
// ever built from a value PayU actually returned — never from client input.
export type NormalizedPaymentResult = {
  merchantTransactionId: string; // PayU txnid == payments.provider_order_id
  providerPaymentId: string | null; // PayU mihpayid, only ever set once verified
  providerStatus: string; // raw PayU status string, for logging only
  normalizedOutcome: NormalizedPaymentOutcome;
  amount: string; // as reported by PayU, verified against Payment.amount before use
  method: string | null;
  verifiedAt: Date;
  verifiedVia: "webhook" | "verify_api";
  safeMetadata: Record<string, string | null>; // sanitized — never the hash/salt
};

export type FinalizationResultCode =
  | "SUCCESS_CONFIRMED" // newly finalized SUCCESS: stock decremented, Order confirmed, Cart finalized
  | "SUCCESS_COMMERCE_EXCEPTION" // newly finalized SUCCESS but stock ran out first — see docs/mypetmart-architecture/payu-inventory-contract.md
  | "FAILED_RECORDED" // newly recorded FAILED/CANCELLED, Order left payable for retry
  | "NOOP_ALREADY_TERMINAL" // idempotent replay — Payment was already paid/failed/refunded/cancelled
  | "NOOP_UNCERTAIN" // normalizedOutcome was PENDING — nothing to mutate yet
  | "REJECTED_UNKNOWN_PAYMENT" // no Payment row matches merchantTransactionId
  | "REJECTED_AMOUNT_MISMATCH"
  | "REJECTED_CURRENCY_MISMATCH";

export type FinalizationOutcome = {
  code: FinalizationResultCode;
  paymentId: number | null;
  orderId: number | null;
};

export type PaymentStatusResultJSON = {
  paymentStatus: string;
  orderId: number;
  orderStatus: string;
  amount: string;
  currency: string;
  commerceException: string | null;
};

// ---------------------------------------------------------------------------
// Cash on Delivery (COD)
// ---------------------------------------------------------------------------

// COD deliberately reuses initiatePaymentSchema's exactly-one-of shape — a
// customer identifies the Order by orderId, a guest by their recovery token,
// exactly like PayU initiation.
export type ConfirmCodOrderInput = InitiatePaymentInput;

// Payment.status is always "pending" here — a COD Payment is never marked
// "paid" automatically (Phase 1 scope: collection reconciliation is a future
// admin action). orderStatus is "confirmed": unlike PayU, there is no
// external gateway round-trip to wait for, so the Order can move straight
// from pending -> confirmed once the COD Payment record exists.
export type CodConfirmationResultJSON = {
  provider: "cod";
  paymentId: number;
  orderId: number;
  orderStatus: string;
  paymentStatus: string;
  amount: string;
  currency: string;
};
