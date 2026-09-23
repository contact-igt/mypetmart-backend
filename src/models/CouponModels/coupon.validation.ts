import { z } from "zod";

// The single place a raw customer/admin-typed code is ever normalized before
// touching the `coupons.code` column or being compared against it — trimmed
// and upper-cased so "save10", "Save10", and "SAVE10" are always the same
// coupon. Reused by both the (future) storefront apply endpoint and the
// (future) admin create/update endpoint.
export function normalizeCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export const couponCodeSchema = z
  .string()
  .trim()
  .min(1, "Coupon code is required.")
  .max(40, "Coupon code cannot exceed 40 characters.")
  .regex(/^[A-Za-z0-9_-]+$/u, "Coupon code may only contain letters, numbers, hyphens, and underscores.");
