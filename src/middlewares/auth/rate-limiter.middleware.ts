import rateLimit from "express-rate-limit";
import { authConfig } from "../../config/auth.config.js";
import { sendError } from "../../utils/api-response.js";

const isTest = process.env.NODE_ENV === "test";

export const authRateLimiter = rateLimit({
  windowMs: authConfig.rateLimitWindowMs,
  max: isTest ? 1000 : authConfig.rateLimitMax,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res, _next) => {
    sendError(res, 429, "AUTH_RATE_LIMITED", "Too many requests. Please try again later.");
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
