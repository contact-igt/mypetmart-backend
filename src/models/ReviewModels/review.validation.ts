import { z } from "zod";
import { REVIEW_SOURCE_VALUES, REVIEW_STATUS_VALUES } from "../../constants/database.constants.js";
import { InvalidReviewIdError } from "./review.errors.js";

export function parseReviewId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidReviewIdError();
}

const reviewTextSchema = z
  .string()
  .trim()
  .min(1, "Review is required")
  .max(5000, "Review must be 5000 characters or fewer")
  .refine((value) => value.length > 0, "Review cannot be whitespace only");

export const createReviewSchema = z.object({
  rating: z.number().int("Rating must be a whole number").min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5"),
  title: z.string().trim().max(160, "Title max 160 characters").nullable().optional(),
  review: reviewTextSchema
});

export const updateReviewSchema = z.object({
  rating: z.number().int("Rating must be a whole number").min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5").optional(),
  title: z.string().trim().max(160, "Title max 160 characters").nullable().optional(),
  review: reviewTextSchema.optional()
});

// Never accepts userId/verifiedPurchase/orderItemId/reviewSource — those are
// always server-derived (see review.service.ts's createAdminReview/updateAdminReview).
export const adminCreateReviewSchema = z.object({
  productId: z.number().int().positive("productId must be a positive integer"),
  customerName: z.string().trim().max(120, "Customer name max 120 characters").nullable().optional(),
  rating: z.number().int("Rating must be a whole number").min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5"),
  title: z.string().trim().max(160, "Title max 160 characters").nullable().optional(),
  review: reviewTextSchema,
  status: z.enum(REVIEW_STATUS_VALUES).optional()
});

export const adminUpdateReviewSchema = z.object({
  rating: z.number().int("Rating must be a whole number").min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5").optional(),
  title: z.string().trim().max(160, "Title max 160 characters").nullable().optional(),
  review: reviewTextSchema.optional(),
  status: z.enum(REVIEW_STATUS_VALUES).optional()
});

const positiveQueryInteger = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().positive()
);

const queryPageSize = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().min(1).max(100)
);

export const publicReviewListQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  sort: z.enum(["newest", "highest", "lowest"]).optional()
});

export const adminReviewListQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  search: z.string().trim().max(190).optional(),
  status: z.enum(REVIEW_STATUS_VALUES).optional(),
  rating: positiveQueryInteger.optional(),
  productId: positiveQueryInteger.optional(),
  source: z.enum(REVIEW_SOURCE_VALUES).optional()
});
