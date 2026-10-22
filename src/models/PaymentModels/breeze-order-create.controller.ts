import type { NextFunction, Request, Response } from "express";

import { paymentConfig } from "../../config/payment.config.js";
import { logger } from "../../utils/logger.js";
import { BreezeOrderCreateService } from "./breeze-order-create.service.js";
import { raiseBreezeAlert } from "./breeze-alerts.service.js";
import { breezeOrderCreateSchema } from "./breeze-order-create.schema.js";
import { verifyBreezeWebhookApiKey } from "./breeze-signature.util.js";

/**
 * Breeze Full 1CCO Order Create Webhook (mounted at
 * POST /api/v1/payments/breeze/order-create-webhook).
 *
 * Contract: docs.breeze.in/order-create-webhook — `X-Api-Key` header (an API
 * credential, NOT an HMAC), body { id, eventName, content }, HTTP 200 with
 * { id, status, message, content: { orderId } } on success.
 *
 * Authentication runs before any parsing or business work, fails closed when
 * no key is configured, and never logs the key or the raw payload. This route
 * stays mounted even when BREEZE_1CCO_ENABLED=false so payments captured for
 * already-signed sessions can still be reconciled.
 */
export async function handleBreezeOrderCreateWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const expectedKey = paymentConfig.breezeOrderWebhookApiKey;
  if (!expectedKey) {
    logger.error("breeze order-create webhook: no API key configured");
    res.status(503).json({ status: "FAILED", message: "Not available." });
    return;
  }

  if (!verifyBreezeWebhookApiKey(req.get("x-api-key")?.trim(), expectedKey)) {
    logger.warn("breeze order-create webhook: X-Api-Key verification failed");
    // One record per hour: repeated failures are counted, not each sent.
    await raiseBreezeAlert("webhook_auth_failures", new Date().toISOString().slice(0, 13), { count: 1 });
    res.status(401).json({ status: "FAILED", message: "Unauthorized." });
    return;
  }

  // req.body is undefined under Express 5 when no parser matched.
  const parsed = breezeOrderCreateSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    // Field paths only — never values (they may carry personal data).
    const paths = [...new Set(parsed.error.issues.map((issue) => issue.path.join(".")))].slice(0, 20);
    logger.warn({ invalidPaths: paths }, "breeze order-create webhook: payload failed schema validation");
    res.status(422).json({ status: "FAILED", message: "Invalid payload.", invalidFields: paths });
    return;
  }

  try {
    const ack = await BreezeOrderCreateService.handle(parsed.data);
    res.status(ack.httpStatus).json(ack.body);
  } catch (error) {
    logger.error({ err: error, eventId: parsed.data.id }, "breeze order-create webhook: internal error");
    // Not acknowledged: nothing false is reported and the event stays retryable.
    await raiseBreezeAlert("webhook_finalization_failed", parsed.data.id, { eventId: parsed.data.id, outcomeCode: "INTERNAL_ERROR" });
    res.status(500).json({ id: parsed.data.id, status: "FAILED", message: "Temporary failure; please retry." });
  }
}
