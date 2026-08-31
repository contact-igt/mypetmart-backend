import type { NextFunction, Request, Response } from "express";

import { paymentConfig } from "../../config/payment.config.js";
import { logger } from "../../utils/logger.js";
import { normalizeBreezeWebhookResult } from "./breeze-result-normalizer.js";
import { verifyBreezeWebhookApiKey } from "./breeze-signature.util.js";
import { PaymentFinalizationService } from "./payment-finalization.service.js";
import type { BreezeWebhookPayload } from "./breeze.types.js";

/**
 * Breeze S2S confirmation endpoint (mounted at
 * POST /api/v1/payments/breeze/webhook). This controller ONLY authenticates,
 * normalizes, and delegates to the shared PaymentFinalizationService — it
 * never mutates Payment/Order/Cart/stock directly, exactly like the PayU
 * webhook controller.
 *
 * Documented contract (docs.breeze.in -> "Order Create Webhook"):
 *   - Auth header:  X-Api-Key: <your API key>  (value == BREEZE_WEBHOOK_SECRET)
 *   - Body:         { id, eventName, content: { orderId, txnId?, status,
 *                     payment: { amount, currency, paymentMethod }, ... } }
 *   - Ack:          HTTP 200 (docs say "with OrderStatus + CreateOrderResponseContent")
 *
 * TODO — BREEZE CONFIRMATION REQUIRED (does not block finalization):
 *   1. Whether this webhook fires for the sendOTP -> verifyOTP -> startPayment
 *      path, or whether a different payment-only webhook is used.
 *   2. The exact 200 acknowledgement body Breeze expects (the docs reference
 *      CreateOrderResponseContent but do not fully enumerate it). We currently
 *      ack with an empty 200 body — the finalization itself is unaffected.
 *   3. Whether Breeze retries on non-2xx, and the retry ceiling.
 */
export async function handleBreezeWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const body = req.body as BreezeWebhookPayload;

  if (!paymentConfig.breezeWebhookSecret) {
    logger.error("breeze webhook: provider not configured (BREEZE_WEBHOOK_SECRET unset)");
    res.status(503).end();
    return;
  }

  const apiKeyValid = verifyBreezeWebhookApiKey(req.get("x-api-key")?.trim(), paymentConfig.breezeWebhookSecret);
  if (!apiKeyValid) {
    logger.warn("breeze webhook: X-Api-Key verification failed, rejected without mutation");
    // Mirror the PayU controller: a durable auth verdict is acked, not retried.
    res.status(200).end();
    return;
  }

  try {
    const normalized = normalizeBreezeWebhookResult(body);

    if (!normalized.merchantTransactionId) {
      logger.warn({ eventName: body.eventName }, "breeze webhook: no usable merchant transaction reference in payload, acked without processing");
      res.status(200).end();
      return;
    }

    const outcome = await PaymentFinalizationService.processVerifiedPaymentResult(normalized);
    logger.info(
      {
        breezeEventName: body.eventName,
        outcomeCode: outcome.code,
        paymentAttemptId: outcome.paymentId,
        orderId: outcome.orderId
      },
      "breeze webhook: processed"
    );
    res.status(200).end();
  } catch (error) {
    logger.error({ err: error }, "breeze webhook: internal error processing verified result");
    res.status(500).end();
  }
}
