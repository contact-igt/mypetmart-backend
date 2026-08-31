import { describe, expect, it } from "vitest";

import { BreezeCartSignatureNotImplementedError, generateBreezeCartSignature, verifyBreezeWebhookApiKey } from "../../src/models/PaymentModels/breeze-signature.util.js";

describe("Breeze webhook API-key verification", () => {
  it("accepts the exact configured secret and rejects anything else, in constant time", () => {
    expect(verifyBreezeWebhookApiKey("expected-api-key", "expected-api-key")).toBe(true);
    expect(verifyBreezeWebhookApiKey("wrong-api-key", "expected-api-key")).toBe(false);
    expect(verifyBreezeWebhookApiKey("expected-api-key-longer", "expected-api-key")).toBe(false);
    expect(verifyBreezeWebhookApiKey(undefined, "expected-api-key")).toBe(false);
    expect(verifyBreezeWebhookApiKey("expected-api-key", undefined)).toBe(false);
  });
});

describe("Breeze cart signature", () => {
  it("is intentionally not implemented for the Phase B1 startPayment flow", () => {
    expect(() => generateBreezeCartSignature()).toThrow(BreezeCartSignatureNotImplementedError);
  });
});
