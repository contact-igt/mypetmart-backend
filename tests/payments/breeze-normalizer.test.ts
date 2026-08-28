import { describe, expect, it } from "vitest";

import { normalizeBreezeWebhookResult } from "../../src/models/PaymentModels/breeze-result-normalizer.js";

describe("normalizeBreezeWebhookResult", () => {
  it("maps a Breeze success webhook to the shared normalized payment result", () => {
    const result = normalizeBreezeWebhookResult({
      event: "PAYMENT_SUCCESS",
      merchant_transaction_id: "BRZ-000123",
      transaction_id: "txn_123",
      amount: "600.00",
      currency: "INR",
      payment_method: "UPI",
      environment: "smb-release"
    });

    expect(result.merchantTransactionId).toBe("BRZ-000123");
    expect(result.providerPaymentId).toBe("txn_123");
    expect(result.normalizedOutcome).toBe("SUCCESS");
    expect(result.amount).toBe("600.00");
    expect(result.method).toBe("UPI");
    expect(result.verifiedVia).toBe("webhook");
    expect(result.safeMetadata.provider).toBe("breeze");
  });

  it("maps Breeze failed and cancelled outcomes without touching finalization logic", () => {
    expect(normalizeBreezeWebhookResult({ status: "failed", merchant_order_id: "BRZ-FAILED", amount: "10.00" }).normalizedOutcome).toBe("FAILED");
    expect(normalizeBreezeWebhookResult({ status: "cancelled", merchant_order_id: "BRZ-CANCELLED", amount: "10.00" }).normalizedOutcome).toBe("CANCELLED");
  });

  it("treats unknown provider statuses as pending rather than inventing a terminal state", () => {
    const result = normalizeBreezeWebhookResult({ status: "awaiting_bank", merchant_order_id: "BRZ-PENDING", amount: "10.00" });

    expect(result.normalizedOutcome).toBe("PENDING");
  });

  it("reads nested Breeze data payloads", () => {
    const result = normalizeBreezeWebhookResult({
      event_type: "payment_update",
      data: {
        status: "success",
        merchantTransactionId: "BRZ-NESTED",
        paymentId: "payment_nested",
        amount: 25,
        method: "CARD"
      }
    });

    expect(result.merchantTransactionId).toBe("BRZ-NESTED");
    expect(result.providerPaymentId).toBe("payment_nested");
    expect(result.amount).toBe("25.00");
    expect(result.method).toBe("CARD");
    expect(result.normalizedOutcome).toBe("SUCCESS");
  });
});
