import { Router } from "express";

import { webhookRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";
import { handleBreezeWebhook } from "./breeze-webhook.controller.js";

export const breezeWebhookRouter = Router();

// Public, provider-facing endpoint. Authenticity is checked in the
// controller using Breeze webhook configuration, not customer/admin auth.
// Mounted at /api/v1/payments/breeze.
breezeWebhookRouter.post("/webhook", webhookRateLimiter, (req, res, next) => {
  void handleBreezeWebhook(req, res, next);
});
