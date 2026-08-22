import { Router } from "express";
import { authRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";
import { StorefrontContactController } from "./contact.controller.js";

const router = Router();

router.post("/", authRateLimiter, (req, res, next) => {
  void StorefrontContactController.createEnquiry(req, res, next);
});

export default router;
