import { Router } from "express";
import { AuthController } from "./auth.controller.js";
import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { authRateLimiter } from "../../middlewares/auth/rate-limiter.middleware.js";

const router = Router();

router.post("/signup", authRateLimiter, (req, res, next) => {
  void AuthController.signup(req, res, next);
});
router.post("/customer/signup", authRateLimiter, (req, res, next) => {
  void AuthController.signup(req, res, next);
});

router.post("/signin", authRateLimiter, (req, res, next) => {
  void AuthController.signin(req, res, next);
});
router.post("/customer/signin", authRateLimiter, (req, res, next) => {
  void AuthController.signin(req, res, next);
});

router.post("/verify-email", authRateLimiter, (req, res, next) => {
  void AuthController.verifyEmail(req, res, next);
});
router.post("/resend-verification", authRateLimiter, (req, res, next) => {
  void AuthController.resendVerification(req, res, next);
});
router.post("/forgot-password", authRateLimiter, (req, res, next) => {
  void AuthController.forgotPassword(req, res, next);
});
router.post("/verify-reset-otp", authRateLimiter, (req, res, next) => {
  void AuthController.verifyResetOTP(req, res, next);
});
router.post("/reset-password", authRateLimiter, (req, res, next) => {
  void AuthController.resetPassword(req, res, next);
});
router.post("/refresh", authRateLimiter, (req, res, next) => {
  void AuthController.refresh(req, res, next);
});
router.post("/logout", (req, res, next) => {
  void AuthController.logout(req, res, next);
});
router.get("/me", authenticate("customer"), (req, res, next) => {
  AuthController.me(req, res, next);
});

export default router;
