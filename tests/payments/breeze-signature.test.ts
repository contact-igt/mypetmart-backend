import { describe, expect, it } from "vitest";

import { BreezeCartSignatureNotImplementedError, generateBreezeCartSignature, verifyBreezeWebhookSignature } from "../../src/models/PaymentModels/breeze-signature.util.js";

describe("Breeze signature utilities", () => {
  it("validates the configured webhook secret using timing-safe comparison", () => {
    expect(verifyBreezeWebhookSignature("expected-secret", "expected-secret")).toBe(true);
    expect(verifyBreezeWebhookSignature("wrong-secret", "expected-secret")).toBe(false);
    expect(verifyBreezeWebhookSignature(undefined, "expected-secret")).toBe(false);
  });

  it("does not invent Breeze cart signature generation before Breeze confirms the algorithm", () => {
    expect(() =>
      generateBreezeCartSignature({
        merchantId: "mypetmart",
        environment: "smb-release",
        merchantTransactionId: "BRZ-000001",
        amount: "100.00",
        currency: "INR",
        orderId: 1
      })
    ).toThrow(BreezeCartSignatureNotImplementedError);
  });
});
