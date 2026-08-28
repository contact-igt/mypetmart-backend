import { Router } from "express";

import { authRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";
import { optionalAuthenticate } from "../../middlewares/auth/optional-authenticate.middleware.js";
import { handleConfirmCodOrder, handleGetPaymentStatus, handleInitiatePayment } from "./storefront-payment.controller.js";

export const storefrontPaymentRouter = Router();

// Rate-limited (reusing the existing auth limiter, the same precedent set by
// the guest Order recovery route) since this accepts unauthenticated guest
// requests and must resist guest-token/order-id probing abuse.
storefrontPaymentRouter.post("/initiate", authRateLimiter, optionalAuthenticate(), (req, res, next) => {
  void handleInitiatePayment(req, res, next);
});

// Browser-return reconciliation surface — same auth shape/precedent as
// /initiate (POST body, not a numeric id in the URL, so a Payment can never
// be looked up by id alone without proving Order ownership first).
storefrontPaymentRouter.post("/status", authRateLimiter, optionalAuthenticate(), (req, res, next) => {
  void handleGetPaymentStatus(req, res, next);
});

// Cash on Delivery confirmation — same auth shape/precedent as /initiate.
// Never touches PayU; creates a "cod"/"pending" Payment and confirms the
// Order directly (see PaymentService.confirmCodOrder).
storefrontPaymentRouter.post("/cod", authRateLimiter, optionalAuthenticate(), (req, res, next) => {
  void handleConfirmCodOrder(req, res, next);
});
