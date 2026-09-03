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

// Admin-controlled public review date. `z.iso.date()` enforces a real
// "YYYY-MM-DD" calendar date — it rejects malformed input ("abc"), impossible
// months/days ("2026-13-40") and invalid leap dates ("2025-02-29") — the same
// convention ShipmentModels/shipment.validation.ts uses. "today" is the
// server's current UTC calendar date (`new Date().toISOString().slice(0, 10)`),
// which matches the DB connection running in UTC and `created_at` being stored
// in UTC; a review date after today is rejected. `null` / omitted are allowed
// and carry the meaning "no custom review date" — never coerced to today.
// Only ever attached to the admin create/update schemas — a customer can never
// send this field (the customer schemas above do not declare it, and Zod
// strips unknown keys).
const adminReviewDateSchema = z.iso
  .date("Review date must be a valid YYYY-MM-DD date")
  .nullable()
  .optional()
  .refine((value) => value == null || value <= new Date().toISOString().slice(0, 10), {
    message: "Review date cannot be in the future"
  });

// Never accepts userId/verifiedPurchase/orderItemId/reviewSource — those are
// always server-derived (see review.service.ts's createAdminReview/updateAdminReview).
export const adminCreateReviewSchema = z.object({
  productId: z.number().int().positive("productId must be a positive integer"),
  customerName: z.string().trim().max(120, "Customer name max 120 characters").nullable().optional(),
  rating: z.number().int("Rating must be a whole number").min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5"),
  title: z.string().trim().max(160, "Title max 160 characters").nullable().optional(),
  review: reviewTextSchema,
  status: z.enum(REVIEW_STATUS_VALUES).optional(),
  reviewDate: adminReviewDateSchema
});

export const adminUpdateReviewSchema = z.object({
  rating: z.number().int("Rating must be a whole number").min(1, "Rating must be between 1 and 5").max(5, "Rating must be between 1 and 5").optional(),
  title: z.string().trim().max(160, "Title max 160 characters").nullable().optional(),
  review: reviewTextSchema.optional(),
  status: z.enum(REVIEW_STATUS_VALUES).optional(),
  reviewDate: adminReviewDateSchema
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
