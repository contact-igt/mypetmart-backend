import crypto from "node:crypto";

import { paymentConfig } from "../../config/payment.config.js";
import { PaymentProviderNotConfiguredError } from "./payment.errors.js";

// PayU Verify Payment API, verified 2026-08-14 against docs.payu.in/
// reference/verify_payment_api — recommended by PayU for reconciling a
// transaction's true state independent of the webhook/browser-return path.
// Pure network client: no DB access, no transaction, never called from
// inside PaymentFinalizationService's transaction (network calls must
// complete before that transaction opens).

export type RawPayuVerifyTransactionDetail = {
  mihpayid?: string;
  status?: string;
  amt?: string;
  mode?: string;
  bank_ref_num?: string;
  error_code?: string;
  additional_charges?: string;
};

export type RawPayuVerifyPaymentResponse = {
  status: number; // 0 = API call failed, 1 = succeeded (NOT the transaction's own status)
  msg?: string;
  transaction_details?: Record<string, RawPayuVerifyTransactionDetail>;
};

function buildVerifyPaymentHash(key: string, txnid: string, salt: string): string {
  // sha512(key|command|var1|salt) — command is always "verify_payment" here.
  const source = `${key}|verify_payment|${txnid}|${salt}`;
  return crypto.createHash("sha512").update(source, "utf8").digest("hex");
}

export const PayuVerifyClient = {
  async verifyPayment(txnid: string): Promise<RawPayuVerifyPaymentResponse> {
    if (!paymentConfig.payuKey || !paymentConfig.payuSalt) {
      throw new PaymentProviderNotConfiguredError();
    }

    const hash = buildVerifyPaymentHash(paymentConfig.payuKey, txnid, paymentConfig.payuSalt);
    const body = new URLSearchParams({
      key: paymentConfig.payuKey,
      command: "verify_payment",
      var1: txnid,
      hash
    });

    const response = await fetch(paymentConfig.verifyApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString()
    });

    if (!response.ok) {
      throw new Error(`PayU Verify Payment API responded with HTTP ${response.status}.`);
    }

    return (await response.json()) as RawPayuVerifyPaymentResponse;
  }
};
