import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NormalizedPaymentResult } from "../../src/models/PaymentModels/payment.types.js";

const finalizationMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/config/payment.config.js", () => ({
  paymentConfig: {
    breezeWebhookSecret: "test_breeze_api_key"
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

const successBody = {
  id: "evt_1",
  eventName: "ORDER_SUCCEEDED",
  content: {
    orderId: "brz_order_1",
    txnId: "BRZ-000001-aaaaaaaaaa",
    status: "SUCCESS",
    payment: { paymentMethod: "UPI", paymentMethodType: "UPI", amount: 499, currency: "INR" }
  }
};

describe("Breeze webhook controller", () => {
  beforeEach(() => {
    finalizationMock.mockReset();
  });

  it("authenticates via X-Api-Key and delegates the normalized result to PaymentFinalizationService", async () => {
    finalizationMock.mockResolvedValue({ code: "SUCCESS_CONFIRMED", paymentId: 1, orderId: 2 });

    const res = await request(appForWebhook()).post("/webhook").set("x-api-key", "test_breeze_api_key").send(successBody);

    expect(res.status).toBe(200);
    expect(finalizationMock).toHaveBeenCalledTimes(1);
    expect(finalizationMock.mock.calls[0]![0]).toMatchObject({
      merchantTransactionId: "BRZ-000001-aaaaaaaaaa",
      normalizedOutcome: "SUCCESS",
      amount: "499.00",
      method: "UPI",
      verifiedVia: "webhook"
    });
  });

  it("rejects a missing / wrong X-Api-Key without finalizing payment", async () => {
    const noKey = await request(appForWebhook()).post("/webhook").send(successBody);
    expect(noKey.status).toBe(200);

    const badKey = await request(appForWebhook()).post("/webhook").set("x-api-key", "nope").send(successBody);
    expect(badKey.status).toBe(200);

    expect(finalizationMock).not.toHaveBeenCalled();
  });

  it("acks a payload with no usable merchant reference without calling the finalizer", async () => {
    const res = await request(appForWebhook())
      .post("/webhook")
      .set("x-api-key", "test_breeze_api_key")
      .send({ id: "evt_2", eventName: "SOMETHING", content: { status: "SUCCESS", payment: { amount: 1 } } });

    expect(res.status).toBe(200);
    expect(finalizationMock).not.toHaveBeenCalled();
  });

  it("acks duplicate/terminal webhooks through the shared finalizer idempotency result", async () => {
    finalizationMock.mockResolvedValue({ code: "NOOP_ALREADY_TERMINAL", paymentId: 7, orderId: 9 });

    const res = await request(appForWebhook()).post("/webhook").set("x-api-key", "test_breeze_api_key").send(successBody);

    expect(res.status).toBe(200);
    expect(finalizationMock).toHaveBeenCalledTimes(1);
  });

  it("acks unknown payments without asking the provider to retry forever", async () => {
    finalizationMock.mockResolvedValue({ code: "REJECTED_UNKNOWN_PAYMENT", paymentId: null, orderId: null });

    const res = await request(appForWebhook())
      .post("/webhook")
      .set("x-api-key", "test_breeze_api_key")
      .send({ id: "e", eventName: "ORDER_SUCCEEDED", content: { txnId: "BRZ-UNKNOWN", status: "SUCCESS", payment: { amount: 10 } } });

    expect(res.status).toBe(200);
    expect(finalizationMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes failed and cancelled webhooks before delegation", async () => {
    finalizationMock.mockResolvedValue({ code: "FAILED_RECORDED", paymentId: 3, orderId: 4 });

    await request(appForWebhook())
      .post("/webhook")
      .set("x-api-key", "test_breeze_api_key")
      .send({ id: "e", eventName: "ORDER_FAILED", content: { txnId: "BRZ-F", status: "FAILED", payment: { amount: 20 } } });
    await request(appForWebhook())
      .post("/webhook")
      .set("x-api-key", "test_breeze_api_key")
      .send({ id: "e", eventName: "ORDER_CANCELLED", content: { txnId: "BRZ-C", status: "CANCELLED", payment: { amount: 20 } } });

    expect((finalizationMock.mock.calls[0]![0] as NormalizedPaymentResult).normalizedOutcome).toBe("FAILED");
    expect((finalizationMock.mock.calls[1]![0] as NormalizedPaymentResult).normalizedOutcome).toBe("CANCELLED");
  });

  it("returns 503 when Breeze is not configured", async () => {
    vi.resetModules();
    vi.doMock("../../src/config/payment.config.js", () => ({ paymentConfig: { breezeWebhookSecret: undefined } }));
    vi.doMock("../../src/models/PaymentModels/payment-finalization.service.js", () => ({
      PaymentFinalizationService: { processVerifiedPaymentResult: finalizationMock }
    }));
    const { handleBreezeWebhook: unconfigured } = await import("../../src/models/PaymentModels/breeze-webhook.controller.js");
    const app = express();
    app.use(express.json());
    app.post("/webhook", (req, res, next) => void unconfigured(req, res, next));

    const res = await request(app).post("/webhook").set("x-api-key", "anything").send(successBody);
    expect(res.status).toBe(503);
    vi.doUnmock("../../src/config/payment.config.js");
    vi.doUnmock("../../src/models/PaymentModels/payment-finalization.service.js");
  });
});
