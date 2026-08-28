import { Router } from "express";

import { authRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";
import { handleStorefrontDeliveryCheck } from "./storefront-serviceability.controller.js";

export const storefrontDeliveryRouter = Router();

// Public (guest + customer). Shares the existing customer-facing abuse
// limiter used by the other unauthenticated storefront POST endpoints
// (contact enquiry, newsletter subscribe) — this endpoint fans out to the
// iThink Rate API, so it must not be callable in an unbounded loop.
storefrontDeliveryRouter.post("/check", authRateLimiter, (req, res, next) => {
  void handleStorefrontDeliveryCheck(req, res, next);
});
