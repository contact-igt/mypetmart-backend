import { Op, type Transaction } from "sequelize";
import { DATABASE_TABLE_NAMES, type CouponDiscountType } from "../../constants/database.constants.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { Coupon, CouponCategory, CouponProduct, CouponRedemption, Order } from "../../database/tables/index.js";
import { CouponNotApplicableError } from "./coupon.errors.js";
import { normalizeCouponCode } from "./coupon.validation.js";
import type { CouponEvaluationInput, CouponEvaluationResult, CouponPricingLine, CouponReservationInput } from "./coupon.types.js";

// Redemption states that still occupy a usage-limit slot. "released" rows
// (a pending order that was safely cancelled — Module 2) explicitly do not
// count, freeing that slot back up; "consumed" and "reserved" both count so
// a still-pending order's reservation blocks a concurrent order from also
// claiming the last use (see COUPON_SYSTEM_REPOSITORY_AUDIT.md §K).
const ACTIVE_REDEMPTION_STATUSES = ["reserved", "consumed"] as const;

function failure(reason: Extract<CouponEvaluationResult, { ok: false }>["reason"], message: string): CouponEvaluationResult {
  return { ok: false, reason, message };
}

export class CouponPricingService {
  /**
   * Sum of price × quantity for every line the coupon's own product/category
   * allowlists permit. No rows in either allowlist means "no restriction of
   * that kind" — a coupon with neither allowlist applies to all merchandise.
   * When either allowlist has entries, a line is eligible if it matches
   * EITHER list (V1 rule: product OR category, not AND).
   */
  public static calculateEligibleMerchandisePaise(lines: CouponPricingLine[], eligibleProductIds: ReadonlySet<number> | null, eligibleCategoryIds: ReadonlySet<number> | null): number {
    const hasRestriction = eligibleProductIds !== null || eligibleCategoryIds !== null;

    let eligiblePaise = 0;
    for (const line of lines) {
      const isEligible = !hasRestriction || Boolean(eligibleProductIds?.has(line.productId)) || Boolean(eligibleCategoryIds?.has(line.categoryId));
      if (isEligible) {
        eligiblePaise += line.unitPricePaise * line.quantity;
      }
    }
    return eligiblePaise;
  }

  /**
   * The one place `discount_type`/`discount_value` are interpreted (see the
   * doc comment on COUPON_DISCOUNT_TYPE_VALUES). Integer paise in, integer
   * paise out — no floating-point arithmetic anywhere in this calculation.
   */
  public static calculateDiscountPaise(discountType: CouponDiscountType, discountValue: number, eligibleMerchandisePaise: number, maxDiscountPaise: number | null): number {
    if (eligibleMerchandisePaise <= 0) return 0;

    let discountPaise =
      discountType === "percentage"
        ? Math.floor((eligibleMerchandisePaise * discountValue) / 10_000)
        : Math.min(discountValue, eligibleMerchandisePaise);

    if (maxDiscountPaise !== null) {
      discountPaise = Math.min(discountPaise, maxDiscountPaise);
    }

    // Never exceed eligible merchandise and never go negative, regardless of
    // how discount_value/max_discount_paise were configured.
    return Math.max(0, Math.min(discountPaise, eligibleMerchandisePaise));
  }

  private static isLineEligible(line: CouponPricingLine, eligibleProductIds: ReadonlySet<number> | null, eligibleCategoryIds: ReadonlySet<number> | null): boolean {
    const hasRestriction = eligibleProductIds !== null || eligibleCategoryIds !== null;
    return !hasRestriction || Boolean(eligibleProductIds?.has(line.productId)) || Boolean(eligibleCategoryIds?.has(line.categoryId));
  }

  /**
   * Splits a total discount across the eligible lines that produced it,
   * proportional to each line's own paise share of eligibleMerchandisePaise —
   * for order_items.discount_allocated_paise (Module 2: partial refunds and
   * financial reconciliation). Flooring each line's share can leave a paise
   * or two unallocated; the remainder is deterministically assigned to the
   * LAST eligible line so the returned amounts always sum exactly to
   * totalDiscountPaise. Ineligible lines always get 0. Returned array is the
   * same length and order as `lines`.
   */
  public static allocateDiscountAcrossLines(
    lines: CouponPricingLine[],
    eligibleProductIds: ReadonlySet<number> | null,
    eligibleCategoryIds: ReadonlySet<number> | null,
    totalDiscountPaise: number
  ): number[] {
    const allocations = new Array<number>(lines.length).fill(0);
    if (totalDiscountPaise <= 0) {
      return allocations;
    }

    const eligibleIndexes: number[] = [];
    let eligibleMerchandisePaise = 0;
    lines.forEach((line, index) => {
      if (this.isLineEligible(line, eligibleProductIds, eligibleCategoryIds)) {
        eligibleIndexes.push(index);
        eligibleMerchandisePaise += line.unitPricePaise * line.quantity;
      }
    });
    if (eligibleIndexes.length === 0 || eligibleMerchandisePaise <= 0) {
      return allocations;
    }

    let allocated = 0;
    for (const index of eligibleIndexes) {
      const line = lines[index]!;
      const linePaise = line.unitPricePaise * line.quantity;
      const share = Math.floor((totalDiscountPaise * linePaise) / eligibleMerchandisePaise);
      allocations[index] = share;
      allocated += share;
    }

    const remainder = totalDiscountPaise - allocated;
    if (remainder > 0) {
      const lastEligibleIndex = eligibleIndexes[eligibleIndexes.length - 1]!;
      allocations[lastEligibleIndex] = (allocations[lastEligibleIndex] ?? 0) + remainder;
    }

    return allocations;
  }

  /**
   * Validates a coupon against the current cart/order lines and identity,
   * then computes its discount — the single calculation both checkout
   * preview and order creation must call (Module 2), so the two can never
   * disagree. Read-only: never reserves, consumes, or mutates anything.
   * Usage-limit counts read here are a courtesy for preview purposes only —
   * the authoritative, race-safe check happens when Module 2 locks the
   * coupon row inside the order-creation transaction.
   */
  public static async evaluateCoupon(input: CouponEvaluationInput): Promise<CouponEvaluationResult> {
    const code = normalizeCouponCode(input.code);

    const coupon = await Coupon.findOne({ where: { code } });
    if (!coupon) {
      return failure("not_found", "This coupon code doesn't exist.");
    }
    if (coupon.status !== "active") {
      return failure("not_active", "This coupon is not currently active.");
    }

    const now = new Date();
    if (coupon.starts_at && now < coupon.starts_at) {
      return failure("not_started", "This coupon isn't active yet.");
    }
    if (coupon.ends_at && now >= coupon.ends_at) {
      return failure("expired", "This coupon has expired.");
    }

    // A coupon carrying any identity-scoped restriction is off-limits to
    // guests entirely (V1 rule) — there is no stable, unspoofable identity
    // to enforce per-customer-limit or first-order-only against for a guest.
    const hasIdentityRestriction = coupon.first_order_only || coupon.per_customer_limit !== null;
    if (hasIdentityRestriction && input.identity.userId === null) {
      return failure("guest_not_allowed_for_restricted_coupon", "Sign in to your account to use this coupon.");
    }

    const [productRows, categoryRows] = await Promise.all([
      CouponProduct.findAll({ where: { coupon_id: coupon.id } }),
      CouponCategory.findAll({ where: { coupon_id: coupon.id } })
    ]);
    const eligibleProductIds = productRows.length > 0 ? new Set(productRows.map((row) => row.product_id)) : null;
    const eligibleCategoryIds = categoryRows.length > 0 ? new Set(categoryRows.map((row) => row.category_id)) : null;

    const eligibleMerchandisePaise = this.calculateEligibleMerchandisePaise(input.lines, eligibleProductIds, eligibleCategoryIds);
    if (eligibleMerchandisePaise <= 0) {
      return failure("no_eligible_items", "None of the items in your cart are eligible for this coupon.");
    }
    if (eligibleMerchandisePaise < coupon.min_eligible_amount_paise) {
      return failure("below_minimum", "Your order doesn't yet meet this coupon's minimum eligible amount.");
    }

    if (coupon.usage_limit !== null) {
      const usedCount = await CouponRedemption.count({ where: { coupon_id: coupon.id, status: { [Op.in]: ACTIVE_REDEMPTION_STATUSES } } });
      if (usedCount >= coupon.usage_limit) {
        return failure("usage_limit_reached", "This coupon has reached its usage limit.");
      }
    }

    if (coupon.per_customer_limit !== null) {
      // input.identity.userId is guaranteed non-null here — guarded above.
      const perCustomerCount = await CouponRedemption.count({
        where: { coupon_id: coupon.id, user_id: input.identity.userId, status: { [Op.in]: ACTIVE_REDEMPTION_STATUSES } }
      });
      if (perCustomerCount >= coupon.per_customer_limit) {
        return failure("per_customer_limit_reached", "You've already used this coupon the maximum number of times.");
      }
    }

    if (coupon.first_order_only) {
      // "First order" means no prior order this user has actually paid for
      // — an abandoned/pending order never counts (V1 rule: don't treat an
      // abandoned pending order as a first completed order).
      const priorPaidOrder = await Order.findOne({ where: { user_id: input.identity.userId, payment_status: "paid" } });
      if (priorPaidOrder) {
        return failure("first_order_only_not_first_order", "This coupon is only valid on a customer's first order.");
      }
    }

    const discountAmountPaise = this.calculateDiscountPaise(coupon.discount_type, coupon.discount_value, eligibleMerchandisePaise, coupon.max_discount_paise);
    if (discountAmountPaise <= 0) {
      return failure("no_eligible_items", "This coupon doesn't apply any discount to your cart.");
    }

    return {
      ok: true,
      couponId: coupon.id,
      codeSnapshot: coupon.code,
      discountTypeSnapshot: coupon.discount_type,
      discountValueSnapshot: coupon.discount_value,
      eligibleMerchandisePaise,
      discountAmountPaise,
      eligibleProductIds: eligibleProductIds ? [...eligibleProductIds] : null,
      eligibleCategoryIds: eligibleCategoryIds ? [...eligibleCategoryIds] : null
    };
  }

  /**
   * For the financial boundary (order creation, Module 2) — throws instead
   * of returning a failure result, since an order can never be created with
   * a coupon that turned out not to apply.
   */
  public static async assertCouponApplicable(input: CouponEvaluationInput): Promise<Extract<CouponEvaluationResult, { ok: true }>> {
    const result = await this.evaluateCoupon(input);
    if (!result.ok) {
      throw new CouponNotApplicableError(result.message);
    }
    return result;
  }

  /**
   * The authoritative, race-safe "lock and reserve coupon capacity
   * atomically" step (Module 2) — called from OrderService.createOrder,
   * inside its own transaction, AFTER the Order row has been created (so
   * orderId is available for the required, NOT NULL, UNIQUE
   * coupon_redemptions.order_id FK). Locking the Coupon row here means two
   * concurrent order-creation transactions racing for a coupon's last
   * remaining use genuinely serialize: whichever commits first is visible to
   * the second's recount once it acquires the same lock, so the second
   * reliably sees the limit as reached and throws instead of both succeeding.
   * Never trusts the caller's own prior evaluateCoupon result for the
   * limit/date checks — only the caller's already-computed discount numbers
   * (eligibleMerchandisePaise/discountAmountPaise), which are pure
   * arithmetic on already-locked, already-reloaded line prices and do not
   * need to be recomputed here.
   */
  public static async reserveCouponForOrder(input: CouponReservationInput, transaction: Transaction): Promise<void> {
    const coupon = await Coupon.findByPk(input.couponId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!coupon || coupon.status !== "active") {
      throw new CouponNotApplicableError("This coupon is no longer available.");
    }

    const now = new Date();
    if (coupon.starts_at && now < coupon.starts_at) {
      throw new CouponNotApplicableError("This coupon isn't active yet.");
    }
    if (coupon.ends_at && now >= coupon.ends_at) {
      throw new CouponNotApplicableError("This coupon has expired.");
    }

    // Both recounts MUST be locking reads. Under REPEATABLE READ a plain
    // SELECT reads this transaction's consistent snapshot, which createOrder
    // already established (cart/order reads) before reaching the coupon lock
    // above — so a racing winner's redemption, committed while we waited on
    // that lock, would be invisible and both orders would reserve the last
    // use (reproduced on staging). A locking read sees the latest committed
    // rows. (findAll rather than count: Sequelize's count() typings omit
    // `lock`; the row set is bounded by the limit being enforced.)
    if (coupon.usage_limit !== null) {
      const used = await CouponRedemption.findAll({
        attributes: ["id"],
        where: { coupon_id: coupon.id, status: { [Op.in]: ACTIVE_REDEMPTION_STATUSES } },
        transaction,
        lock: transaction.LOCK.SHARE
      });
      if (used.length >= coupon.usage_limit) {
        throw new CouponNotApplicableError("This coupon has reached its usage limit.");
      }
    }

    if (coupon.per_customer_limit !== null && input.userId !== null) {
      const perCustomer = await CouponRedemption.findAll({
        attributes: ["id"],
        where: { coupon_id: coupon.id, user_id: input.userId, status: { [Op.in]: ACTIVE_REDEMPTION_STATUSES } },
        transaction,
        lock: transaction.LOCK.SHARE
      });
      if (perCustomer.length >= coupon.per_customer_limit) {
        throw new CouponNotApplicableError("You've already used this coupon the maximum number of times.");
      }
    }

    const redemptionId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.couponRedemptions, transaction);
    await CouponRedemption.create(
      {
        id: redemptionId,
        coupon_id: input.couponId,
        order_id: input.orderId,
        user_id: input.userId,
        guest_identity_hash: input.guestIdentityHash,
        code_snapshot: input.codeSnapshot,
        discount_type_snapshot: input.discountTypeSnapshot,
        discount_value_snapshot: input.discountValueSnapshot,
        eligible_merchandise_paise: input.eligibleMerchandisePaise,
        discount_amount_paise: input.discountAmountPaise,
        status: "reserved"
      },
      { transaction }
    );
  }

  /**
   * Releases a reserved redemption when its Order is safely cancelled while
   * still pending (V1 rule) — called from
   * OrderModels/order.service.ts's performPendingOrderCancellation, inside
   * that same cancellation transaction. A no-op (0 rows updated) for an
   * Order that never had a coupon, or whose redemption already moved past
   * "reserved" — safe to call unconditionally.
   */
  public static async releaseCouponReservation(orderId: number, transaction: Transaction): Promise<void> {
    await CouponRedemption.update({ status: "released", released_at: new Date() }, { where: { order_id: orderId, status: "reserved" }, transaction });
  }

  /**
   * Marks a reserved redemption consumed once its Order is a genuinely
   * completed purchase — called from both
   * PaymentFinalizationService.processVerifiedPaymentResult (online SUCCESS
   * path) and PaymentService.confirmCodOrder (COD confirmation), inside
   * their own existing transactions. A no-op for an Order with no coupon.
   * V1 rule: a refund afterward never automatically restores usage, so
   * nothing ever transitions a redemption back out of "consumed".
   */
  public static async consumeCouponReservation(orderId: number, transaction: Transaction): Promise<void> {
    await CouponRedemption.update({ status: "consumed", consumed_at: new Date() }, { where: { order_id: orderId, status: "reserved" }, transaction });
  }
}
