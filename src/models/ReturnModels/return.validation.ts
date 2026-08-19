import { z } from "zod";

import { InvalidReturnIdError } from "./return.errors.js";

export function parseReturnId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidReturnIdError();
}

export const createReturnRequestSchema = z.object({
  orderId: z.number().int().positive("orderId must be a positive integer"),
  orderItemId: z.number().int().positive("orderItemId must be a positive integer"),
  quantity: z.number().int().positive("quantity must be a positive integer"),
  reason: z.string().trim().min(1, "A return reason is required.").max(2000, "Reason must be 2000 characters or fewer.")
  ,resolution: z.enum(["refund", "replacement"]).default("refund")
});

export const adminReviewReturnSchema = z.object({
  action: z.enum(["approve", "reject"]),
  note: z.string().trim().min(1).max(2000).optional()
});

export const addReturnNoteSchema = z.object({
  message: z.string().trim().min(1, "A note message is required.").max(2000, "Note must be 2000 characters or fewer.")
});

export const listReturnsQuerySchema = z.object({
  status: z.enum(["requested", "approved", "rejected", "resolved"]).optional(),
  resolution: z.enum(["refund", "replacement"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20)
});
