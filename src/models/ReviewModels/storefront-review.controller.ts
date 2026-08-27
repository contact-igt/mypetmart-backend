import type { NextFunction, Request, Response } from "express";

import { AuthSession, User } from "../../database/tables/index.js";
import { TokenService } from "../../services/auth/token.service.js";
import { sendSuccess } from "../../utils/api-response.js";
import { ReviewService } from "./review.service.js";
import { createReviewSchema, publicReviewListQuerySchema, updateReviewSchema } from "./review.validation.js";
import { parseProductId } from "../ProductModels/product.validation.js";
import type { CreateReviewInput, PublicReviewListQuery, UpdateReviewInput } from "./review.types.js";

// The review-eligibility endpoint must return a safe, non-error state for an
// unauthenticated visitor (§18) — it deliberately does NOT sit behind the
// shared authenticate("customer") middleware (which throws 401 on a
// missing/invalid token). This performs the same Bearer-token -> Session ->
// User resolution authenticate.middleware.ts does, but degrades to `null`
// instead of throwing, and only for this one read-only endpoint.
async function resolveOptionalCustomerId(req: Request): Promise<number | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }
  const token = authHeader.substring(7).trim();
  if (!token) {
    return null;
  }

  try {
    const payload = TokenService.verifyAccessToken(token, "customer");
    if (payload.sessionType !== "customer") {
      return null;
    }
    const sessionId = Number(payload.sessionId);
    if (!Number.isSafeInteger(sessionId) || sessionId <= 0) {
      return null;
    }

    const session = await AuthSession.findOne({
      where: { id: sessionId, session_type: "customer" },
      include: [{ model: User, as: "user" }]
    });
    if (!session || session.revoked_at !== null || new Date(session.expires_at) < new Date()) {
      return null;
    }

    const user = session.user;
    if (!user || user.status !== "active" || user.role !== "customer") {
      return null;
    }

    return user.id;
  } catch {
    return null;
  }
}

function requireUserId(req: Request): number {
  // authenticate("customer") always runs ahead of every route that calls
  // this (see storefront-review.routes.ts) — req.user is guaranteed.
  if (!req.user) {
    throw new Error("Customer identity was not resolved before reaching the controller.");
  }
  return req.user.id;
}

export async function handleCreateReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = createReviewSchema.parse(req.body) as CreateReviewInput;
    const review = await ReviewService.createReview(requireUserId(req), productId, validated);
    sendSuccess(res, 201, review);
  } catch (error) {
    next(error);
  }
}

export async function handleUpdateOwnReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = updateReviewSchema.parse(req.body) as UpdateReviewInput;
    const review = await ReviewService.updateOwnReview(requireUserId(req), productId, validated);
    sendSuccess(res, 200, review);
  } catch (error) {
    next(error);
  }
}

export async function handleListPublicReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const query = publicReviewListQuerySchema.parse(req.query) as PublicReviewListQuery;
    const result = await ReviewService.listPublicReviews(productId, query);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleGetReviewEligibility(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const userId = await resolveOptionalCustomerId(req);

    if (!userId) {
      sendSuccess(res, 200, { authenticated: false, eligible: false, hasReview: false });
      return;
    }

    const result = await ReviewService.getReviewEligibility(userId, productId);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}
