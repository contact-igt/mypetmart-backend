/* eslint-disable */
// Tests for coupon payment-method eligibility (migration 082).
// Covers:
//  1. A "both" coupon accepts PayU and COD.
//  2. A "payu" coupon is rejected with payment_method_ineligible when COD is
//     selected and accepted when PayU is selected.
//  3. A "cod" coupon is rejected with payment_method_ineligible when PayU is
//     selected and accepted when COD is selected.
//  4. alternativeSaving is returned with the correct discountAmountPaise and
//     eligiblePaymentMethod from the engine — never from the client.
//  5. evaluateCoupon with no paymentMethod field skips the check (backward
//     compatibility: cart-apply path that has no payment method yet).
//  6. assertCouponApplicable throws on payment_method_ineligible.
//  7. reserveCouponForOrder throws when the payment method is ineligible, even
//     if assertCouponApplicable previously succeeded (stale-preview guard).
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { Category, Coupon, CouponRedemption, Order, Product, User } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { DATABASE_TABLE_NAMES } from "../../src/constants/database.constants.js";
import { CouponPricingService } from "../../src/models/CouponModels/coupon.service.js";

const DEFAULT_LINES = [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }];

describe("CouponPricingService — payment_method_eligibility", () => {
  const createdCouponIds: number[] = [];
  const createdOrderIds: number[] = [];

  async function createCoupon(eligibility: "both" | "payu" | "cod", discountValue = 1000): Promise<Coupon> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.coupons, t);
      const coupon = await Coupon.create(
        {
          id,
          code: `PME-TEST-${id}`,
          name: `PME test coupon ${id}`,
          discount_type: "percentage",
          discount_value: discountValue,
          status: "active",
          payment_method_eligibility: eligibility
        } as any,
        { transaction: t }
      );
      createdCouponIds.push(coupon.id);
      return coupon;
    });
  }

  async function createOrder(userId: number | null, paymentStatus: "pending" | "paid"): Promise<number> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.orders, t);
      await Order.create(
        {
          id,
          order_number: `PME-ORD-${id}`,
          user_id: userId,
          payment_status: paymentStatus,
          ship_recipient_name: "Test Customer",
          ship_phone: "9999999999",
          ship_line_1: "1 Test St",
          ship_city: "Bangalore",
          ship_state: "Karnataka",
          ship_postal_code: "560001"
        } as any,
        { transaction: t }
      );
      createdOrderIds.push(id);
      return id;
    });
  }

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await CouponRedemption.destroy({ where: { coupon_id: createdCouponIds }, force: true });
    await Coupon.destroy({ where: { id: createdCouponIds }, force: true });
    await Order.destroy({ where: { id: createdOrderIds }, force: true });
    await disconnectDatabase();
  });

  // ─────────────────────────── eligibility: both ───────────────────────────

  it("payment_method_eligibility='both' accepts PayU", async () => {
    const coupon = await createCoupon("both");
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES,
      identity: { userId: null },
      paymentMethod: "payu"
    });
    expect(result.ok).toBe(true);
  });

  it("payment_method_eligibility='both' accepts COD", async () => {
    const coupon = await createCoupon("both");
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES,
      identity: { userId: null },
      paymentMethod: "cod"
    });
    expect(result.ok).toBe(true);
  });

  // ─────────────────────────── eligibility: payu ───────────────────────────

  it("payment_method_eligibility='payu' accepts PayU", async () => {
    const coupon = await createCoupon("payu");
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES,
      identity: { userId: null },
      paymentMethod: "payu"
    });
    expect(result.ok).toBe(true);
  });

  it("payment_method_eligibility='payu' rejects COD with payment_method_ineligible", async () => {
    const coupon = await createCoupon("payu");
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES,
      identity: { userId: null },
      paymentMethod: "cod"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("payment_method_ineligible");
      expect(result.message).toMatch(/Prepaid/i);
    }
  });

  it("returns alternativeSaving with eligiblePaymentMethod='payu' and server-calculated paise when rejecting COD", async () => {
    // 10% of ₹100 = ₹10 = 1000 paise
    const coupon = await createCoupon("payu", 1000);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES, // 10_000 paise eligible
      identity: { userId: null },
      paymentMethod: "cod"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("payment_method_ineligible");
      expect(result.alternativeSaving).toBeDefined();
      expect(result.alternativeSaving?.eligiblePaymentMethod).toBe("payu");
      // 10% of 10_000 = 1000 paise
      expect(result.alternativeSaving?.discountAmountPaise).toBe(1000);
      expect(result.alternativeSaving?.code).toBe(coupon.code);
    }
  });

  // ─────────────────────────── eligibility: cod ───────────────────────────

  it("payment_method_eligibility='cod' accepts COD", async () => {
    const coupon = await createCoupon("cod");
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES,
      identity: { userId: null },
      paymentMethod: "cod"
    });
    expect(result.ok).toBe(true);
  });

  it("payment_method_eligibility='cod' rejects PayU with payment_method_ineligible", async () => {
    const coupon = await createCoupon("cod");
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES,
      identity: { userId: null },
      paymentMethod: "payu"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("payment_method_ineligible");
      expect(result.message).toMatch(/Cash on Delivery/i);
    }
  });

  it("returns alternativeSaving with eligiblePaymentMethod='cod' and server-calculated paise when rejecting PayU", async () => {
    const coupon = await createCoupon("cod", 1000); // 10%
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES, // 10_000 paise eligible
      identity: { userId: null },
      paymentMethod: "payu"
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("payment_method_ineligible");
      expect(result.alternativeSaving).toBeDefined();
      expect(result.alternativeSaving?.eligiblePaymentMethod).toBe("cod");
      expect(result.alternativeSaving?.discountAmountPaise).toBe(1000);
      expect(result.alternativeSaving?.code).toBe(coupon.code);
    }
  });

  // ──────────── backward compatibility: no paymentMethod supplied ───────────

  it("skips the payment-method check when paymentMethod is omitted (cart-apply backward compat)", async () => {
    // A payu-only coupon should still be evaluable without a payment method
    // — this is the cart-apply path which has no payment method context yet.
    const coupon = await createCoupon("payu");
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES,
      identity: { userId: null }
      // no paymentMethod field
    });
    expect(result.ok).toBe(true);
  });

  // ─── payment-method check runs AFTER other eligibility (reason ordering) ──

  it("returns payment_method_ineligible only when all other eligibility checks pass", async () => {
    // A coupon that is also expired: the engine should return 'expired', not
    // 'payment_method_ineligible', because expiry is checked before payment method.
    const pastEnd = new Date(Date.now() - 1000);
    const coupon = await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.coupons, t);
      const c = await Coupon.create(
        { id, code: `PME-EXP-${id}`, name: "PME Expired", discount_type: "percentage", discount_value: 1000, status: "active", ends_at: pastEnd, payment_method_eligibility: "payu" } as any,
        { transaction: t }
      );
      createdCouponIds.push(c.id);
      return c;
    });

    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: DEFAULT_LINES,
      identity: { userId: null },
      paymentMethod: "cod"
    });
    expect(result.ok).toBe(false);
    // Expiry is checked before payment method — so this should be 'expired'.
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  // ─────────── assertCouponApplicable rejects payment_method_ineligible ────

  it("assertCouponApplicable throws CouponNotApplicableError for payment_method_ineligible", async () => {
    const coupon = await createCoupon("payu");
    await expect(
      CouponPricingService.assertCouponApplicable({
        code: coupon.code,
        lines: DEFAULT_LINES,
        identity: { userId: null },
        paymentMethod: "cod"
      })
    ).rejects.toThrow();
  });

  // ─────────── reserveCouponForOrder enforces payment method under lock ────

  it("reserveCouponForOrder throws when payment method is ineligible (stale-preview guard)", async () => {
    const coupon = await createCoupon("payu"); // prepaid-only
    // Simulate: the checkout preview was for 'payu' (so evaluation passed),
    // but the order is being submitted as 'cod'.
    const orderId = await createOrder(null, "pending");

    await expect(
      sequelize.transaction(async (t) => {
        await CouponPricingService.reserveCouponForOrder(
          {
            couponId: coupon.id,
            orderId,
            userId: null,
            guestIdentityHash: null,
            codeSnapshot: coupon.code,
            discountTypeSnapshot: "percentage",
            discountValueSnapshot: 1000,
            eligibleMerchandisePaise: 10_000,
            discountAmountPaise: 1000,
            paymentMethod: "cod" // mismatches the coupon's payu eligibility
          },
          t
        );
      })
    ).rejects.toThrow("Prepaid");
  });

  it("reserveCouponForOrder succeeds when payment method matches", async () => {
    const coupon = await createCoupon("payu");
    const orderId = await createOrder(null, "pending");

    await expect(
      sequelize.transaction(async (t) => {
        await CouponPricingService.reserveCouponForOrder(
          {
            couponId: coupon.id,
            orderId,
            userId: null,
            guestIdentityHash: null,
            codeSnapshot: coupon.code,
            discountTypeSnapshot: "percentage",
            discountValueSnapshot: 1000,
            eligibleMerchandisePaise: 10_000,
            discountAmountPaise: 1000,
            paymentMethod: "payu" // matches
          },
          t
        );
      })
    ).resolves.not.toThrow();
  });
});
