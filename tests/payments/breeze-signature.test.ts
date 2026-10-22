import crypto from "node:crypto";

import { describe, expect, it } from "vitest";

import { signBreezeCart, verifyBreezeWebhookApiKey } from "../../src/models/PaymentModels/breeze-signature.util.js";

describe("Breeze webhook API-key verification", () => {
  it("accepts the exact configured secret and rejects anything else, in constant time", () => {
    expect(verifyBreezeWebhookApiKey("expected-api-key", "expected-api-key")).toBe(true);
    expect(verifyBreezeWebhookApiKey("wrong-api-key", "expected-api-key")).toBe(false);
    expect(verifyBreezeWebhookApiKey("expected-api-key-longer", "expected-api-key")).toBe(false);
    expect(verifyBreezeWebhookApiKey(undefined, "expected-api-key")).toBe(false);
    expect(verifyBreezeWebhookApiKey("expected-api-key", undefined)).toBe(false);
  });
});

describe("Breeze cart signature (RSA-SHA256, base64)", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" }
  });
  const cart = JSON.stringify({ id: "c1", totalPrice: 10000 });

  it("verifies with the matching public key", () => {
    const signature = signBreezeCart(cart, privateKey);
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(cart, "utf8");
    expect(verifier.verify(publicKey, signature, "base64")).toBe(true);
  });

  it("fails verification when the cart is tampered with", () => {
    const signature = signBreezeCart(cart, privateKey);
    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(JSON.stringify({ id: "c1", totalPrice: 1 }), "utf8");
    expect(verifier.verify(publicKey, signature, "base64")).toBe(false);
  });
});
