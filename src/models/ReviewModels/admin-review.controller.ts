import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ReviewService } from "./review.service.js";
import { adminCreateReviewSchema, adminReviewListQuerySchema, adminUpdateReviewSchema, parseReviewId } from "./review.validation.js";
import type { AdminCreateReviewInput, AdminReviewListQuery, AdminUpdateReviewInput } from "./review.types.js";

export async function handleAdminListReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = adminReviewListQuerySchema.parse(req.query) as AdminReviewListQuery;
    const result = await ReviewService.listAdminReviews(query);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminGetReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const reviewId = parseReviewId(req.params.reviewId);
    const review = await ReviewService.getAdminReview(reviewId);
    sendSuccess(res, 200, review);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateReviewStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const reviewId = parseReviewId(req.params.reviewId);
    const validated = adminUpdateReviewSchema.parse(req.body) as AdminUpdateReviewInput;
    const review = await ReviewService.updateReviewStatus(reviewId, validated);
    sendSuccess(res, 200, review);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminCreateReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = adminCreateReviewSchema.parse(req.body) as AdminCreateReviewInput;
    const review = await ReviewService.createAdminReview(validated);
    sendSuccess(res, 201, review);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const reviewId = parseReviewId(req.params.reviewId);
    await ReviewService.deleteAdminReview(reviewId);
    sendSuccess(res, 200, { message: "Review deleted successfully" });
  } catch (error) {
    next(error);
  }
}
