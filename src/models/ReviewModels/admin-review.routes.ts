import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminCreateReview,
  handleAdminDeleteReview,
  handleAdminGetReview,
  handleAdminListReviews,
  handleAdminUpdateReviewStatus
} from "./admin-review.controller.js";

export const adminReviewRouter = Router();

// Open to both admin and super_admin — moderation is not a super_admin-only
// action (mirrors admin-return.routes.ts's approve/reject gate; unlike real
// refund initiation, this never moves money).
adminReviewRouter.use(authenticate("admin"));

adminReviewRouter.get("/", (req, res, next) => {
  void handleAdminListReviews(req, res, next);
});

adminReviewRouter.post("/", (req, res, next) => {
  void handleAdminCreateReview(req, res, next);
});

adminReviewRouter.get("/:reviewId", (req, res, next) => {
  void handleAdminGetReview(req, res, next);
});

adminReviewRouter.patch("/:reviewId", (req, res, next) => {
  void handleAdminUpdateReviewStatus(req, res, next);
});

adminReviewRouter.delete("/:reviewId", (req, res, next) => {
  void handleAdminDeleteReview(req, res, next);
});
