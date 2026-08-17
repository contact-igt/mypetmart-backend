import { Router } from "express";
import { AdminAuthController } from "./admin-auth.controller.js";
import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { authRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";

const router = Router();

router.post("/signin", authRateLimiter, (req, res, next) => {
  void AdminAuthController.signin(req, res, next);
});
router.post("/refresh", authRateLimiter, (req, res, next) => {
  void AdminAuthController.refresh(req, res, next);
});
router.post("/logout", (req, res, next) => {
  void AdminAuthController.logout(req, res, next);
});
router.get("/me", authenticate("admin"), (req, res, next) => {
  AdminAuthController.me(req, res, next);
});

export default router;
