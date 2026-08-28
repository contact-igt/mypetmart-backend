import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedPaymentResult } from "../../src/models/PaymentModels/payment.types.js";

const finalizationMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/config/payment.config.js", () => ({
  paymentConfig: {
    breezeWebhookSecret: "test_breeze_webhook_secret"
  }
}));

vi.mock("../../src/models/PaymentModels/payment-finalization.service.js", () => ({
  PaymentFinalizationService: {
    processVerifiedPaymentResult: finalizationMock
  }
}));

const { handleBreezeWebhook } = await import("../../src/models/PaymentModels/breeze-webhook.controller.js");

function appForWebhook() {
  const app = express();
  app.use(express.json());
  app.post("/webhook", (req, res, next) => {
    void handleBreezeWebhook(req, res, next);
  });
  return app;
}

describe("Breeze webhook controller", () => {
  beforeEach(() => {
    finalizationMock.mockReset();
  });

  it("accepts a valid webhook and delegates the normalized result to PaymentFinalizationService", async () => {
    finalizationMock.mockResolvedValue({ code: "SUCCESS_CONFIRMED", paymentId: 1, orderId: 2 });

    const res = await request(appForWebhook())
      .post("/webhook")
      .set("x-breeze-signature", "test_breeze_webhook_secret")
      .send({
        event: "PAYMENT_SUCCESS",
        merchant_transaction_id: "BRZ-000001",
        transaction_id: "txn_000001",
        amount: "499.00",
        payment_method: "UPI"
      });

    expect(res.status).toBe(200);
    expect(finalizationMock).toHaveBeenCalledTimes(1);
    expect(finalizationMock.mock.calls[0]![0]).toMatchObject({
      merchantTransactionId: "BRZ-000001",
      providerPaymentId: "txn_000001",
      normalizedOutcome: "SUCCESS",
      amount: "499.00",
      method: "UPI"
    });
  });

  it("rejects an invalid signature without finalizing payment", async () => {
    const res = await request(appForWebhook())
      .post("/webhook")
      .set("x-breeze-signature", "bad-secret")
      .send({ event: "PAYMENT_SUCCESS", merchant_transaction_id: "BRZ-000002", amount: "499.00" });

    expect(res.status).toBe(200);
    expect(finalizationMock).not.toHaveBeenCalled();
  });

  it("acks duplicate terminal webhooks through the shared finalizer idempotency result", async () => {
    finalizationMock.mockResolvedValue({ code: "NOOP_ALREADY_TERMINAL", paymentId: 7, orderId: 9 });

    const res = await request(appForWebhook())
      .post("/webhook")
      .set("authorization", "Bearer test_breeze_webhook_secret")
      .send({ event: "PAYMENT_SUCCESS", merchant_transaction_id: "BRZ-DUPLICATE", transaction_id: "txn_dup", amount: "10.00" });

    expect(res.status).toBe(200);
    expect(finalizationMock).toHaveBeenCalledTimes(1);
  });

  it("acks unknown payments without retrying forever", async () => {
    finalizationMock.mockResolvedValue({ code: "REJECTED_UNKNOWN_PAYMENT", paymentId: null, orderId: null });

    const res = await request(appForWebhook())
      .post("/webhook")
      .set("x-breeze-webhook-secret", "test_breeze_webhook_secret")
      .send({ event: "PAYMENT_SUCCESS", merchant_transaction_id: "BRZ-UNKNOWN", transaction_id: "txn_unknown", amount: "10.00" });

    expect(res.status).toBe(200);
    expect(finalizationMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes failed and cancelled webhooks before delegation", async () => {
    finalizationMock.mockResolvedValue({ code: "FAILED_RECORDED", paymentId: 3, orderId: 4 });

    await request(appForWebhook()).post("/webhook").set("x-breeze-signature", "test_breeze_webhook_secret").send({ status: "failed", merchant_order_id: "BRZ-FAILED", amount: "20.00" });
    await request(appForWebhook()).post("/webhook").set("x-breeze-signature", "test_breeze_webhook_secret").send({ status: "cancelled", merchant_order_id: "BRZ-CANCELLED", amount: "20.00" });

    expect((finalizationMock.mock.calls[0]![0] as NormalizedPaymentResult).normalizedOutcome).toBe("FAILED");
    expect((finalizationMock.mock.calls[1]![0] as NormalizedPaymentResult).normalizedOutcome).toBe("CANCELLED");
  });
});
