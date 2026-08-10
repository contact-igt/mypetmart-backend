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
