import { ApplicationError } from "../../utils/application-error.js";

export class CouponError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({ statusCode, code, message, isOperational: true });
    this.name = "CouponError";
  }
}

// Thrown by assertCouponApplicable — the financial boundary (order creation,
// Module 2) must hard-fail rather than silently drop the discount; a
// preview-style caller should instead branch on CouponEvaluationResult.ok
// and never need this to throw.
export class CouponNotApplicableError extends CouponError {
  public constructor(message: string) {
    super("COUPON_NOT_APPLICABLE", message, 422);
    this.name = "CouponNotApplicableError";
  }
}
