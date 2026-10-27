import rateLimit from "express-rate-limit";
import { authConfig } from "../../config/auth.config.js";
import { sendError } from "../../utils/api-response.js";

const isTest = process.env.NODE_ENV === "test";

function createAuthRateLimiter() {
  return rateLimit({
  windowMs: authConfig.rateLimitWindowMs,
  max: isTest ? 1000 : authConfig.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next) => {
    sendError(res, 429, "AUTH_RATE_LIMITED", "Too many requests. Please try again later.");
  }
  });
}

// Each sensitive workflow gets an independent budget. Sharing one store made
// normal storefront activity capable of locking an administrator out.
export const authRateLimiter = createAuthRateLimiter();
export const adminAuthRateLimiter = createAuthRateLimiter();
export const breezeCheckoutStartRateLimiter = createAuthRateLimiter();

// Breeze confirms payment asynchronously, so its client polls for a short time.
// Keep that traffic separate from login and payment-start rate limits.
export const breezeCheckoutStatusRateLimiter = rateLimit({
  windowMs: 60_000,
  max: isTest ? 1000 : 60,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next) => {
    sendError(res, 429, "BREEZE_STATUS_RATE_LIMITED", "Too many payment-status checks. Please try again shortly.");
  }
});

// Deliberately a separate limiter instance from authRateLimiter — a
// provider-facing webhook must never share a rate budget with
// customer/guest-facing traffic (a misbehaving or heavily-retrying provider
// could otherwise exhaust the shared budget and lock out real customers).
// PayU itself only retries a given event up to 3 times on a non-200
// response (see PaymentModels/payu-webhook docs), so a generous, provider-
// appropriate ceiling is used here rather than the tighter customer-auth one.
export const webhookRateLimiter = rateLimit({
  windowMs: 60_000,
  max: isTest ? 1000 : 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res, _next) => {
    res.status(429).end();
  }
});
