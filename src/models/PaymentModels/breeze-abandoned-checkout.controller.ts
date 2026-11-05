import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { paymentConfig } from "../../config/payment.config.js";
import { BreezeCheckoutSession } from "../../database/tables/index.js";
import { logger } from "../../utils/logger.js";
import { verifyBreezeWebhookApiKey } from "./breeze-signature.util.js";

const abandonedCheckoutSchema = z
  .object({
    cartDetails: z
      .object({
        orderId: z.string().trim().regex(/^[0-9a-f]{32}$/iu)
      })
      .passthrough(),
    customer: z.unknown().optional(),
    comments: z.unknown().optional(),
    checkoutUrl: z.string().optional()
  })
  .passthrough();

/**
 * Breeze Abandoned Checkout callback, mounted at
 * POST /api/v1/payments/breeze/abandoned-checkout-webhook.
 *
 * `cartDetails.orderId` is used as the signed Cart Object `id`, which maps to
 * our opaque checkout-session public_id.
 */
export async function handleBreezeAbandonedCheckoutWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
  logger.info({ path: req.originalUrl, method: req.method, hasApiKey: Boolean(req.get("x-api-key")) }, "breeze abandoned-checkout webhook: incoming request received");

  const expectedKey = paymentConfig.breezeAbandonedCheckoutApiKey;
  if (!expectedKey) {
    logger.error("breeze abandoned-checkout webhook: no API key configured");
    res.status(503).json({ status: "FAILED", message: "Not available." });
    return;
  }

  if (!verifyBreezeWebhookApiKey(req.get("x-api-key")?.trim(), expectedKey)) {
    logger.warn("breeze abandoned-checkout webhook: X-Api-Key verification failed");
    res.status(401).json({ status: "FAILED", message: "Unauthorized." });
    return;
  }

  const parsed = abandonedCheckoutSchema.safeParse(req.body);
  if (!parsed.success) {
    logger.warn({ issues: parsed.error.issues, payload: req.body }, "breeze abandoned-checkout webhook: payload validation failed");
    res.status(422).json({ status: "FAILED", message: "Invalid payload." });
    return;
  }

  // Abandonment is not evidence that a payment could not have been captured.
  // Keep the attempt guard in place until an authoritative order/payment event
  // or an audited admin release resolves the session.
  const session = await BreezeCheckoutSession.findOne({
    attributes: ["id", "created_at"],
    where: { public_id: parsed.data.cartDetails.orderId }
  });
  logger.info(
    
    {
      sessionPublicId: parsed.data.cartDetails.orderId,
      sessionFound: Boolean(session),
      ...(session ? { delayMs: Math.max(0, Date.now() - session.created_at.getTime()) } : {})
    },
    "breeze abandoned-checkout webhook: authenticated event received"
  );
  res.status(200).json({ status: "RECEIVED" });
}
