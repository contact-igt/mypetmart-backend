import { describe, expect, it } from "vitest";

import { normalizeBreezeWebhookResult } from "../../src/models/PaymentModels/breeze-result-normalizer.js";

// Shapes here follow the documented Breeze "Order Create Webhook" body:
//   { id, eventName, content: { orderId, txnId?, status, payment: {...} } }

describe("normalizeBreezeWebhookResult", () => {
  it("maps a documented success webhook to the shared normalized payment result", () => {
    const result = normalizeBreezeWebhookResult({
      id: "1234",
      eventName: "ORDER_SUCCEEDED",
      content: {
        orderId: "q8A0DCeE-iz9NKO2VAYnh",
        txnId: "BRZ-000123-abcdef0123",
        status: "SUCCESS",
        payment: { paymentMethod: "NB_DUMMY", paymentMethodType: "NB", amount: 499, currency: "INR" }
      }
    });

    expect(result.merchantTransactionId).toBe("BRZ-000123-abcdef0123");
    expect(result.normalizedOutcome).toBe("SUCCESS");
    expect(result.amount).toBe("499.00");
    expect(result.method).toBe("NB_DUMMY");
    expect(result.verifiedVia).toBe("webhook");
    expect(result.safeMetadata.provider).toBe("breeze");
    expect(result.safeMetadata.currency).toBe("INR");
  });

  it("falls back to content.orderId, then content.cart.id, for the merchant reference", () => {
    expect(
      normalizeBreezeWebhookResult({ eventName: "ORDER_SUCCEEDED", content: { orderId: "ord_1", status: "SUCCESS", payment: { amount: 10 } } })
        .merchantTransactionId
    ).toBe("ord_1");

    expect(
      normalizeBreezeWebhookResult({ eventName: "x", content: { status: "PENDING", cart: { id: "cart_9" }, payment: { amount: 10 } } })
        .merchantTransactionId
    ).toBe("cart_9");
  });

  it("maps failed and cancelled order statuses without inventing a terminal state elsewhere", () => {
    expect(
      normalizeBreezeWebhookResult({ eventName: "ORDER_FAILED", content: { txnId: "BRZ-1", status: "FAILED", payment: { amount: 20 } } })
        .normalizedOutcome
    ).toBe("FAILED");
    expect(
      normalizeBreezeWebhookResult({ eventName: "ORDER_CANCELLED", content: { txnId: "BRZ-2", status: "CANCELLED", payment: { amount: 20 } } })
        .normalizedOutcome
    ).toBe("CANCELLED");
  });

  it("treats PARTIALLY_PAID and unknown statuses as PENDING (never auto-confirm)", () => {
    expect(
      normalizeBreezeWebhookResult({ eventName: "x", content: { txnId: "BRZ-3", status: "PARTIALLY_PAID", payment: { amount: 20 } } })
        .normalizedOutcome
    ).toBe("PENDING");
    expect(
      normalizeBreezeWebhookResult({ eventName: "x", content: { txnId: "BRZ-4", status: "awaiting_bank", payment: { amount: 20 } } })
        .normalizedOutcome
    ).toBe("PENDING");
  });

  it("reads a payload that nests the content under eventData/data", () => {
    const result = normalizeBreezeWebhookResult({
      eventName: "payment_update",
      data: { txnId: "BRZ-NESTED", status: "SUCCESS", payment: { amount: 25, currency: "INR", paymentMethod: "UPI" } }
    });

    expect(result.merchantTransactionId).toBe("BRZ-NESTED");
    expect(result.amount).toBe("25.00");
    expect(result.method).toBe("UPI");
    expect(result.normalizedOutcome).toBe("SUCCESS");
  });
});
