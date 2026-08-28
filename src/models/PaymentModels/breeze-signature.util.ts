import crypto from "node:crypto";

import type { BreezeSignaturePayload } from "./breeze.types.js";

export class BreezeCartSignatureNotImplementedError extends Error {
  public constructor() {
    super("Breeze cart signature generation requires the exact Breeze signing algorithm and key format before implementation.");
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

export function verifyBreezeWebhookSignature(providedSignature: string | undefined, webhookSecret: string | undefined): boolean {
  if (!providedSignature || !webhookSecret) {
    return false;
  }
  return timingSafeStringEqual(webhookSecret, providedSignature);
}

export function generateBreezeCartSignature(_payload: BreezeSignaturePayload): string {
  // TODO(Breeze Phase 2): implement only after Breeze confirms the canonical
  // payload shape, hashing/signing algorithm, and private signing material.
  // The Phase 1 foundation must not invent a cart-signature algorithm.
  throw new BreezeCartSignatureNotImplementedError();
}
