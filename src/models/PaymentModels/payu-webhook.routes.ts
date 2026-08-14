import { Router } from "express";

import { webhookRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";
import { handlePayuWebhook } from "./payu-webhook.controller.js";

export const payuWebhookRouter = Router();

// Public, provider-facing endpoint — deliberately no optionalAuthenticate()/
// authenticate() gate. Authenticity comes entirely from PayU's own
// reverse-hash verification (verifyPayuResponseHash) inside the controller,
// never from a customer/admin session or network-layer allowlisting.
// Mounted at /api/v1/payments/payu (routes/v1/index.ts) — deliberately a
// separate top-level namespace from /storefront/payments, since this route
// is never called by the storefront browser.
payuWebhookRouter.post("/webhook", webhookRateLimiter, (req, res, next) => {
  void handlePayuWebhook(req, res, next);
});
