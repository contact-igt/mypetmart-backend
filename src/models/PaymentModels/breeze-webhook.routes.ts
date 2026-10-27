import { Router } from "express";

import { webhookRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";
import { handleBreezeOrderCreateWebhook } from "./breeze-order-create.controller.js";
import { handleBreezeWebhook } from "./breeze-webhook.controller.js";

export const breezeWebhookRouter = Router();

// Public, provider-facing endpoint. Authenticity is checked in the
// controller using Breeze webhook configuration, not customer/admin auth.
// Mounted at /api/v1/payments/breeze.
breezeWebhookRouter.post("/webhook", webhookRateLimiter, (req, res, next) => {
  handleBreezeWebhook(req, res, next).catch(next);
});

// Full 1CCO "Order Create Webhook" bridge — separate from the payment-only
// webhook above. Kept mounted even when BREEZE_1CCO_ENABLED=false so already
// captured payments can still be reconciled.
breezeWebhookRouter.post("/order-create-webhook", webhookRateLimiter, (req, res, next) => {
  handleBreezeOrderCreateWebhook(req, res, next).catch(next);
});
