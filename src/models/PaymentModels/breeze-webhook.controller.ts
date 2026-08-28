import type { NextFunction, Request, Response } from "express";

import { paymentConfig } from "../../config/payment.config.js";
import { logger } from "../../utils/logger.js";
import { normalizeBreezeWebhookResult } from "./breeze-result-normalizer.js";
import { verifyBreezeWebhookSignature } from "./breeze-signature.util.js";
import { PaymentFinalizationService } from "./payment-finalization.service.js";
import type { BreezeWebhookPayload } from "./breeze.types.js";

function readBearerToken(header: string | undefined): string | undefined {
  if (!header) {
    return undefined;
  }
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  return match?.[1]?.trim();
}

function readProvidedSignature(req: Request): string | undefined {
  return (
    req.get("x-breeze-signature")?.trim() ||
    req.get("x-breeze-webhook-secret")?.trim() ||
    readBearerToken(req.get("authorization"))
  );
}

/**
 * Breeze payment webhook/S2S confirmation endpoint. This controller only
 * authenticates, normalizes, and delegates to PaymentFinalizationService; it
 * must never mutate Payment/Order/Cart/stock directly.
 */
export async function handleBreezeWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const body = req.body as BreezeWebhookPayload;

  if (!paymentConfig.breezeWebhookSecret) {
    logger.error("breeze webhook: payment provider not configured");
    res.status(503).end();
    return;
  }

  const signatureValid = verifyBreezeWebhookSignature(readProvidedSignature(req), paymentConfig.breezeWebhookSecret);
  if (!signatureValid) {
    logger.warn("breeze webhook: signature verification failed, rejected without mutation");
    res.status(200).end();
    return;
  }

  try {
    const normalized = normalizeBreezeWebhookResult(body);
    const outcome = await PaymentFinalizationService.processVerifiedPaymentResult(normalized);
    logger.info(
      {
        merchantTransactionId: normalized.merchantTransactionId,
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
