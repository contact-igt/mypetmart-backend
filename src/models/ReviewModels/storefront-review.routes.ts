import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleCreateReview,
  handleGetReviewEligibility,
  handleListPublicReviews,
  handleUpdateOwnReview
} from "./storefront-review.controller.js";

export const storefrontReviewRouter = Router();

// Public — approved Reviews + rating summary only (see review.service.ts).
storefrontReviewRouter.get("/:productId/reviews", (req, res, next) => {
  void handleListPublicReviews(req, res, next);
});

// Deliberately NOT behind authenticate("customer") — must return a safe
// unauthenticated state instead of a 401 (see storefront-review.controller.ts's
// resolveOptionalCustomerId).
storefrontReviewRouter.get("/:productId/review-eligibility", (req, res, next) => {
  void handleGetReviewEligibility(req, res, next);
});

storefrontReviewRouter.post("/:productId/reviews", authenticate("customer"), (req, res, next) => {
  void handleCreateReview(req, res, next);
});

storefrontReviewRouter.patch("/:productId/reviews/me", authenticate("customer"), (req, res, next) => {
  void handleUpdateOwnReview(req, res, next);
});
