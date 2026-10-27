import { Router } from "express";
import { AdminAuthController } from "./admin-auth.controller.js";
import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { adminAuthRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";

const router = Router();

router.post("/signin", adminAuthRateLimiter, (req, res, next) => {
  void AdminAuthController.signin(req, res, next);
});
router.post("/refresh", adminAuthRateLimiter, (req, res, next) => {
  void AdminAuthController.refresh(req, res, next);
});
router.post("/logout", (req, res, next) => {
  void AdminAuthController.logout(req, res, next);
});
router.get("/me", authenticate("admin"), (req, res, next) => {
  AdminAuthController.me(req, res, next);
});

export default router;
