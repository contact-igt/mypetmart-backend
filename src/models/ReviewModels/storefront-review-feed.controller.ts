import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ReviewService } from "./review.service.js";
import { publicReviewListQuerySchema } from "./review.validation.js";
import type { PublicReviewListQuery } from "./review.types.js";

export async function handleListStorefrontReviewFeed(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = publicReviewListQuerySchema.parse(req.query) as PublicReviewListQuery;
    sendSuccess(res, 200, await ReviewService.listPublicReviewsGlobal(query));
  } catch (error) {
    next(error);
  }
}
