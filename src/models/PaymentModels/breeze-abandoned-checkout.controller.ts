import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

import { paymentConfig } from "../../config/payment.config.js";
import { logger } from "../../utils/logger.js";
import { verifyBreezeWebhookApiKey } from "./breeze-signature.util.js";

const abandonedCheckoutSchema = z
  .object({
    cartDetails: z.object({}).passthrough(),
    customer: z.object({}).passthrough(),
    comments: z.unknown().optional(),
    checkoutUrl: z.string().url()
  })
  .passthrough();

/**
 * Breeze Abandoned Checkout callback, mounted at
 * POST /api/v1/payments/breeze/abandoned-checkout-webhook.
 *
 * The published contract supplies an X-Api-Key but not a stable identifier
 * that we can safely map to a checkout session. Acknowledging authenticated
 * events makes the URL ready for Breeze configuration without risking a
 * duplicate payment by releasing a session based on customer/cart details.
 */
export async function handleBreezeAbandonedCheckoutWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
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

  if (!abandonedCheckoutSchema.safeParse(req.body).success) {
    res.status(422).json({ status: "FAILED", message: "Invalid payload." });
    return;
  }

  logger.info("breeze abandoned-checkout webhook: authenticated event received");
  res.status(200).json({ status: "RECEIVED" });
}
