import type { CouponDiscountType } from "../../constants/database.constants.js";

// One authoritative cart/order line, as recomputed by the caller from live
// product/variant/category records — this module never trusts a
// browser-supplied price or category. `categoryId` is the product's own
// category (products belong to exactly one category in this schema).
export type CouponPricingLine = {
  productId: number;
  categoryId: number;
  unitPricePaise: number;
  quantity: number;
};

// `userId === null` means a guest. There is deliberately no "guest identity"
// field here beyond that boolean-ish distinction — guests are only ever
// allowed to use a coupon with none of the identity-scoped restrictions
// (per-customer limit, first-order-only), so no guest identity is ever
// actually checked against a limit in Module 1.
export type CouponEvaluationIdentity = {
  userId: number | null;
};

export type CouponEvaluationInput = {
  code: string;
  lines: CouponPricingLine[];
  identity: CouponEvaluationIdentity;
};

export type CouponEvaluationSuccess = {
  ok: true;
  couponId: number;
  // Everything below is exactly what a redemption row (Module 2) or an
  // order snapshot should persist — this function's success result is
  // designed to be written down verbatim, not recomputed later.
  codeSnapshot: string;
  discountTypeSnapshot: CouponDiscountType;
  discountValueSnapshot: number;
  eligibleMerchandisePaise: number;
  discountAmountPaise: number;
  // The exact allowlists this evaluation used to decide eligibility — null
  // means "no restriction of that kind" (see calculateEligibleMerchandisePaise).
  // Order creation reuses these (via allocateDiscountAcrossLines) instead of
  // re-querying CouponProduct/CouponCategory, so the per-line allocation can
  // never disagree with the aggregate eligibleMerchandisePaise above.
  eligibleProductIds: number[] | null;
  eligibleCategoryIds: number[] | null;
};

export type CouponEvaluationFailureReason =
  | "not_found"
  | "not_active"
  | "not_started"
  | "expired"
  | "below_minimum"
  | "no_eligible_items"
  | "usage_limit_reached"
  | "per_customer_limit_reached"
  | "first_order_only_not_first_order"
  | "guest_not_allowed_for_restricted_coupon";

export type CouponEvaluationFailure = {
  ok: false;
  reason: CouponEvaluationFailureReason;
  // Safe to show a customer as-is — never includes internal IDs or another
  // customer's data.
  message: string;
};

export type CouponEvaluationResult = CouponEvaluationSuccess | CouponEvaluationFailure;

// Everything CouponPricingService.reserveCouponForOrder needs to lock,
// re-validate, and persist a "reserved" CouponRedemption row inside the
// caller's own order-creation transaction. guestIdentityHash mirrors
// orders.guest_identity_hash — null for a customer.
export type CouponReservationInput = {
  couponId: number;
  orderId: number;
  userId: number | null;
  guestIdentityHash: string | null;
  codeSnapshot: string;
  discountTypeSnapshot: CouponDiscountType;
  discountValueSnapshot: number;
  eligibleMerchandisePaise: number;
  discountAmountPaise: number;
};
