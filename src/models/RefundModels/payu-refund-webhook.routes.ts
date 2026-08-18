import { Router } from "express";

import { webhookRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";
import { handlePayuRefundWebhook } from "./payu-refund-webhook.controller.js";

export const payuRefundWebhookRouter = Router();

// Public, provider-facing endpoint — deliberately no authenticate() gate,
// same precedent as payu-webhook.routes.ts. Mounted at
// /api/v1/payments/payu/refund-webhook (routes/v1/index.ts), matching the
// URL payment.config.ts's refundWebhookUrl hands to PayU as var5 on
// cancel_refund_transaction.
payuRefundWebhookRouter.post("/refund-webhook", webhookRateLimiter, (req, res, next) => {
  void handlePayuRefundWebhook(req, res, next);
});
