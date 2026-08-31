import crypto from "node:crypto";

/**
 * Thrown if anything tries to produce a Breeze *cart signature*. The cart
 * signature (RSA-2048 / SHA-256 / PKCS#1 v1.5 / base64 over the stringified
 * Breeze Cart Object) is ONLY required for the full `startCheckout` 1CCO
 * flow. Phase B1 implements `sendOTP -> verifyOTP -> startPayment`, which the
 * official docs define with no `cart` / `signature` / `keyId` fields — so no
 * signing material is generated or stored in this phase.
 */
export class BreezeCartSignatureNotImplementedError extends Error {
  public constructor() {
    super(
      "Breeze cart signature generation is not part of the startPayment flow (Phase B1). It is only needed for the full startCheckout 1CCO flow and requires the Breeze-issued keyId + an RSA private key."
    );
    this.name = "BreezeCartSignatureNotImplementedError";
  }
}

function timingSafeStringEqual(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}

/**
 * Authenticates a Breeze S2S webhook request. Per the Order Create Webhook
 * docs the only documented authentication is a shared API key sent in the
 * `X-Api-Key` request header — there is NO documented body signature/HMAC.
 * The expected value is BREEZE_WEBHOOK_SECRET (paymentConfig.breezeWebhookSecret).
 * Constant-time compare; returns only a boolean, never logs either value.
 */
export function verifyBreezeWebhookApiKey(providedApiKey: string | undefined, expectedSecret: string | undefined): boolean {
  if (!providedApiKey || !expectedSecret) {
    return false;
  }
  return timingSafeStringEqual(expectedSecret, providedApiKey);
}

/**
 * @deprecated Not used by the Phase B1 startPayment flow. Present only so the
 * intent is explicit and greppable: do NOT invent a cart-signature algorithm.
 */
export function generateBreezeCartSignature(): never {
  throw new BreezeCartSignatureNotImplementedError();
}
