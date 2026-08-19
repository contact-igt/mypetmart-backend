import type { NextFunction, Request, Response } from "express";

import { logger } from "../../utils/logger.js";
import { RefundService } from "./refund.service.js";

type RawPayuRefundWebhookBody = {
  token?: string;
  request_id?: string;
  status?: string;
  mihpayid?: string;
};

/**
 * PayU refund-status callback. Public, provider-facing — never customer/
 * admin authenticated, same precedent as payu-webhook.routes.ts. Unlike the
 * payment webhook, PayU's documented refund-status callback payload
 * (docs.payu.in/reference/refund-status-callback, verified 2026-08-17)
 * carries no hash/signature field — so its own `status` claim is never
 * trusted. It is only ever used to look up which Refund to re-verify via the
 * authoritative Status API (see RefundService.handleRefundWebhook); the
 * actual outcome always comes from that re-verification, never this body.
 * Always acks 200 once the payload has been durably handled (found-and-
 * reconciled or safely ignored) — only a genuine internal error returns
 * non-2xx.
 */
export async function handlePayuRefundWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const body = req.body as RawPayuRefundWebhookBody;

  try {
    const outcome = await RefundService.handleRefundWebhook(body.token);
    logger.info({ token: body.token, outcomeCode: outcome?.code ?? "IGNORED" }, "payu refund webhook: processed");
    res.status(200).end();
  } catch (error) {
    logger.error({ err: error, token: body.token }, "payu refund webhook: internal error processing");
    res.status(500).end();
  }
}
