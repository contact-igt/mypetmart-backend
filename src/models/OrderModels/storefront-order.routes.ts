import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { authRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";
import { resolveCartIdentity } from "../../middlewares/cart/resolve-cart-identity.middleware.js";
import { handleCancelCustomerOrder, handleCancelGuestOrder, handleCreateOrder, handleDownloadCustomerReceipt, handleDownloadGuestReceipt, handleGetCustomerOrder, handleGetGuestOrder, handleListCustomerOrders } from "./storefront-order.controller.js";

export const storefrontOrderRouter = Router();

// Order Creation supports both a guest Cart/session and an authenticated
// customer — the same identity resolution Checkout Preview already uses.
// This route is registered BEFORE the authenticate("customer") gate below so
// a request never reaches that gate for POST "/".
storefrontOrderRouter.post("/", resolveCartIdentity(), (req, res, next) => {
  void handleCreateOrder(req, res, next);
});

// Guest Order recovery: the only way a guest can retrieve an Order, since
// GET "/:orderId" below is customer-only. Token-gated, not session-gated —
// registered before the authenticate("customer") gate for the same reason
// POST "/" is. Rate-limited (reusing the existing auth limiter) since it is
// an unauthenticated lookup surface, even though the token itself is
// high-entropy and not brute-forceable in practice.
storefrontOrderRouter.get("/guest/:token", authRateLimiter, (req, res, next) => {
  void handleGetGuestOrder(req, res, next);
});

// Same token-gated, pre-auth-gate placement as guest Order recovery above —
// PDF generation is heavier than a JSON lookup, so this shares that route's
// rate limit rather than being left unlimited.
storefrontOrderRouter.get("/guest/:token/receipt", authRateLimiter, (req, res, next) => {
  void handleDownloadGuestReceipt(req, res, next);
});

// Guest self-service cancellation of an unfinished pending Order — same
// token-gated, pre-auth-gate placement as guest Order recovery above.
// Rate-limited (reusing the existing auth limiter, the same precedent every
// other unauthenticated guest Order/payment mutation follows) since it is an
// unauthenticated surface that also triggers a PayU Verify reconciliation call.
storefrontOrderRouter.post("/guest/:token/cancel", authRateLimiter, (req, res, next) => {
  void handleCancelGuestOrder(req, res, next);
});

// Order history/detail remain customer-authenticated only — guest Order
// recovery uses the dedicated token-gated route above instead.
storefrontOrderRouter.use(authenticate("customer"));

storefrontOrderRouter.get("/", (req, res, next) => {
  void handleListCustomerOrders(req, res, next);
});

storefrontOrderRouter.get("/:orderId", (req, res, next) => {
  void handleGetCustomerOrder(req, res, next);
});

// Customer self-service cancellation of their own unfinished pending Order.
// Shares the auth limiter used by the sensitive payment mutations (/initiate,
// /cod) — cancellation likewise triggers an outbound PayU Verify call.
storefrontOrderRouter.post("/:orderId/cancel", authRateLimiter, (req, res, next) => {
  void handleCancelCustomerOrder(req, res, next);
});

storefrontOrderRouter.get("/:orderId/receipt", (req, res, next) => {
  void handleDownloadCustomerReceipt(req, res, next);
});
