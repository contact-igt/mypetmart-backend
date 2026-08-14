import type { RawPayuVerifyPaymentResponse } from "./payu-verify.client.js";
import type { NormalizedPaymentOutcome, NormalizedPaymentResult } from "./payment.types.js";

// Single source of truth for turning an untrusted/raw PayU shape (webhook
// form body or Verify Payment API response) into the one normalized result
// PaymentFinalizationService consumes. Status mapping is based only on
// PayU's currently-documented values (docs.payu.in/docs/
// webhook-events-and-sample-payloads and .../reference/verify_payment_api),
// never invented: "success" -> SUCCESS, "failure"/"failed" -> FAILED,
// "pending" or anything else undocumented -> PENDING (never guessed as
// FAILED/CANCELLED without clear provider evidence — see task security
// requirements). No CANCELLED mapping exists today because PayU does not
// document a distinct cancelled status for this webhook/API.

export type RawPayuWebhookBody = {
  status?: string;
  txnid?: string;
  amount?: string;
  mihpayid?: string;
  mode?: string;
  email?: string;
  firstname?: string;
  productinfo?: string;
  hash?: string;
  error?: string;
  error_Message?: string;
  unmappedstatus?: string;
  bank_ref_num?: string;
  net_amount_debit?: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
};

function mapProviderStatus(rawStatus: string | undefined): NormalizedPaymentOutcome {
  switch ((rawStatus ?? "").trim().toLowerCase()) {
    case "success":
      return "SUCCESS";
    case "failure":
    case "failed":
      return "FAILED";
    case "pending":
      return "PENDING";
    default:
      return "PENDING";
  }
}

export function normalizeWebhookResult(body: RawPayuWebhookBody): NormalizedPaymentResult {
  return {
    merchantTransactionId: body.txnid ?? "",
    providerPaymentId: body.mihpayid || null,
    providerStatus: body.status ?? "",
    normalizedOutcome: mapProviderStatus(body.status),
    amount: body.amount ?? "0.00",
    method: body.mode || null,
    verifiedAt: new Date(),
    verifiedVia: "webhook",
    safeMetadata: {
      mode: body.mode ?? null,
      bank_ref_num: body.bank_ref_num ?? null,
      error: body.error ?? null,
      error_message: body.error_Message ?? null,
      unmappedstatus: body.unmappedstatus ?? null
    }
  };
}

export function normalizeVerifyApiResult(txnid: string, raw: RawPayuVerifyPaymentResponse): NormalizedPaymentResult {
  // status 0 means the API call itself failed (auth error, unknown txnid,
  // etc.) — never treat this as a FAILED transaction, only as uncertain.
  if (raw.status !== 1) {
    return {
      merchantTransactionId: txnid,
      providerPaymentId: null,
      providerStatus: raw.msg ?? "",
      normalizedOutcome: "PENDING",
      amount: "0.00",
      method: null,
      verifiedAt: new Date(),
      verifiedVia: "verify_api",
      safeMetadata: { apiMessage: raw.msg ?? null }
    };
  }

  const detail = raw.transaction_details?.[txnid];
  // "Not Found" or a missing detail entry is genuinely uncertain, not a
  // signal the payment failed — PayU may simply not have reconciled yet.
  if (!detail || detail.status === "Not Found") {
    return {
      merchantTransactionId: txnid,
      providerPaymentId: null,
      providerStatus: detail?.status ?? "Not Found",
      normalizedOutcome: "PENDING",
      amount: "0.00",
      method: null,
      verifiedAt: new Date(),
      verifiedVia: "verify_api",
      safeMetadata: {}
    };
  }

  return {
    merchantTransactionId: txnid,
    providerPaymentId: detail.mihpayid || null,
    providerStatus: detail.status ?? "",
    normalizedOutcome: mapProviderStatus(detail.status),
    amount: detail.amt ?? "0.00",
    method: detail.mode || null,
    verifiedAt: new Date(),
    verifiedVia: "verify_api",
    safeMetadata: {
      mode: detail.mode ?? null,
      bank_ref_num: detail.bank_ref_num ?? null,
      error_code: detail.error_code ?? null,
      additional_charges: detail.additional_charges ?? null
    }
  };
}
