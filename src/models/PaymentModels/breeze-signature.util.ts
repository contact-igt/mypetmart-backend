import crypto from "node:crypto";

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
 * Signs the stringified Breeze Cart Object for startCheckout.
 * Documented (docs.breeze.in/cart-sign-api): RSA-2048 keypair, signature over
 * JSON.stringify(cartObject) with the merchant private key, public key shared
 * with Breeze. RSA-SHA256 / PKCS#1 v1.5 / base64 follows Juspay's reference
 * signing sample. Backend-only: the PEM never leaves the server.
 */
export function signBreezeCart(stringifiedCart: string, privateKeyPem: string): string {
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(stringifiedCart, "utf8");
  signer.end();
  return signer.sign(privateKeyPem, "base64");
}
