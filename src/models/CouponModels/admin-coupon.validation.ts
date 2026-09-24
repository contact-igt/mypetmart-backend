import { z } from "zod";
import { COUPON_DISCOUNT_TYPE_VALUES, COUPON_PAYMENT_METHOD_ELIGIBILITY_VALUES, COUPON_REDEMPTION_STATUS_VALUES, COUPON_STATUS_VALUES } from "../../constants/database.constants.js";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { CouponError } from "./coupon.errors.js";

const nullablePositiveInt = z.number().int().positive().nullable();
const nullableDate = z.string().datetime({ offset: true }).nullable().transform((value) => (value === null ? null : new Date(value)));
const idList = z.array(z.number().int().positive()).max(500).transform((ids) => [...new Set(ids)]);

export const AdminCouponInputSchema = z.object({
  code: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(160),
  discountType: z.enum(COUPON_DISCOUNT_TYPE_VALUES),
  discountValue: z.number().int().positive(),
  maxDiscountPaise: nullablePositiveInt,
  minEligibleAmountPaise: z.number().int().min(0),
  startsAt: nullableDate,
  endsAt: nullableDate,
  usageLimit: nullablePositiveInt,
  perCustomerLimit: nullablePositiveInt,
  firstOrderOnly: z.boolean(),
  // Which payment method(s) this coupon is valid for. Defaults to "both" —
  // all existing coupons created without this field behave as before.
  paymentMethodEligibility: z.enum(COUPON_PAYMENT_METHOD_ELIGIBILITY_VALUES).default("both"),
  eligibleProductIds: idList,
  eligibleCategoryIds: idList
}).superRefine((value, context) => {
  if (value.discountType === "percentage" && value.discountValue > 10_000) {
    context.addIssue({ code: "custom", path: ["discountValue"], message: "Percentage discount cannot exceed 100%." });
  }
  if (value.discountType === "fixed" && value.maxDiscountPaise !== null) {
    context.addIssue({ code: "custom", path: ["maxDiscountPaise"], message: "Maximum discount is only valid for percentage coupons." });
  }
  if (value.startsAt && value.endsAt && value.endsAt <= value.startsAt) {
    context.addIssue({ code: "custom", path: ["endsAt"], message: "Expiry must be after the start date." });
  }
  if (value.usageLimit !== null && value.perCustomerLimit !== null && value.perCustomerLimit > value.usageLimit) {
    context.addIssue({ code: "custom", path: ["perCustomerLimit"], message: "Per-customer limit cannot exceed the global usage limit." });
  }
});

export const AdminCouponStatusSchema = z.object({ status: z.enum(COUPON_STATUS_VALUES) });

export const AdminCouponListSchema = z.object({
  search: z.string().trim().max(160).optional(),
  status: z.enum(COUPON_STATUS_VALUES).optional(),
  discountType: z.enum(COUPON_DISCOUNT_TYPE_VALUES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z.enum(["code", "name", "status", "discountType", "startsAt", "endsAt", "createdAt", "updatedAt"]).default("createdAt"),
  sortDir: z.enum(["ASC", "DESC"]).default("DESC")
});

export const AdminCouponRedemptionListSchema = z.object({
  status: z.enum(COUPON_REDEMPTION_STATUS_VALUES).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20)
});

export function parseCouponId(value: unknown): number {
  try {
    return parseStrictIdClaim(typeof value === "string" ? value : undefined);
  } catch {
    throw new CouponError("COUPON_INVALID_ID", "Coupon ID must be a positive integer.", 400);
  }
}

export type AdminCouponInput = z.infer<typeof AdminCouponInputSchema>;
export type AdminCouponListQuery = z.infer<typeof AdminCouponListSchema>;
export type AdminCouponRedemptionListQuery = z.infer<typeof AdminCouponRedemptionListSchema>;
