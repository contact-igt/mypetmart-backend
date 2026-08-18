import { paymentConfig } from "../../config/payment.config.js";
import { RefundProviderNotConfiguredError } from "./refund.errors.js";
import { buildPayuCommandHash } from "./payu-refund.util.js";

// PayU V1 Refund Initiation + Status APIs — verified 2026-08-17 against
// docs.payu.in/reference/refund_transaction_api and .../
// check_action_status_api_with_request_id. Both live on the exact same
// merchant postservice endpoint as Verify Payment (paymentConfig.refundApiUrl
// aliases paymentConfig.verifyApiUrl — see payment.config.ts). Pure network
// clients: no DB access, no transaction, mirroring payu-verify.client.ts.

export type RawPayuRefundInitiateResponse = {
  status: number; // 1 = PayU accepted/queued the request, 0 = the API call itself was rejected — NEVER "money has moved" either way.
  msg?: string;
  request_id?: string;
  bank_ref_num?: string;
  mihpayid?: string;
};

export type RawPayuRefundStatusDetail = {
  mihpayid?: string;
  bank_ref_num?: string;
  request_id?: string;
  amt?: string;
  mode?: string;
  action?: string;
  status?: string; // QUEUED | SUCCESS | FAILURE | "IN PROGRESS" | REQUESTED | od_hit
  bank_arn?: string | null;
  settlement_id?: string | null;
  amount_settled?: string | null;
  UTR_no?: string | null;
  value_date?: string | null;
  refund_mode?: string;
};

export type RawPayuRefundStatusResponse = {
  status: number;
  msg?: string;
  transaction_details?: Record<string, RawPayuRefundStatusDetail>;
};

function assertConfigured(): { key: string; salt: string } {
  if (!paymentConfig.payuKey || !paymentConfig.payuSalt) {
    throw new RefundProviderNotConfiguredError();
  }
  return { key: paymentConfig.payuKey, salt: paymentConfig.payuSalt };
}

export const PayuRefundClient = {
  /**
   * command=cancel_refund_transaction. var2 (the merchant refund token) is
   * capped at 23 characters by PayU — callers must pass an already-validated
   * token (RefundService generates refund_number, which is well under that
   * limit — see refund.service.ts).
   */
  async initiateRefund(mihpayid: string, refundToken: string, amount: string, webhookUrl: string): Promise<RawPayuRefundInitiateResponse> {
    const { key, salt } = assertConfigured();
    const hash = buildPayuCommandHash(key, "cancel_refund_transaction", mihpayid, salt);
    const body = new URLSearchParams({
      key,
      command: "cancel_refund_transaction",
      var1: mihpayid,
      var2: refundToken,
      var3: amount,
      var5: webhookUrl,
      hash
    });

    const response = await fetch(paymentConfig.refundApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      throw new Error(`PayU Refund Initiation API responded with HTTP ${response.status}.`);
    }

    return (await response.json()) as RawPayuRefundInitiateResponse;
  },

  /** command=check_action_status_txnid, var1=the request_id returned at initiation. */
  async checkRefundStatus(requestId: string): Promise<RawPayuRefundStatusResponse> {
    const { key, salt } = assertConfigured();
    const hash = buildPayuCommandHash(key, "check_action_status_txnid", requestId, salt);
    const body = new URLSearchParams({
      key,
      command: "check_action_status_txnid",
      var1: requestId,
      hash
    });

    const response = await fetch(paymentConfig.refundApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      throw new Error(`PayU Refund Status API responded with HTTP ${response.status}.`);
    }

    return (await response.json()) as RawPayuRefundStatusResponse;
  }
};
