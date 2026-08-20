import { Router } from "express";

import { authRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";
import { NewsletterController } from "./newsletter.controller.js";

export const storefrontNewsletterRouter = Router();

storefrontNewsletterRouter.post("/subscribe", authRateLimiter, (req, res, next) => {
  void NewsletterController.subscribe(req, res, next);
});

storefrontNewsletterRouter.post("/verify", authRateLimiter, (req, res, next) => {
  void NewsletterController.verify(req, res, next);
});

storefrontNewsletterRouter.post("/unsubscribe", authRateLimiter, (req, res, next) => {
  void NewsletterController.unsubscribe(req, res, next);
});

storefrontNewsletterRouter.post("/resend-unsubscribe-link", authRateLimiter, (req, res, next) => {
  void NewsletterController.resendUnsubscribeLink(req, res, next);
});
