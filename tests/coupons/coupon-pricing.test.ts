/* eslint-disable */
// Module 1 (database + pricing engine only — see COUPON_SYSTEM_REPOSITORY_AUDIT.md
// §M Phase 1) tests: the pure calculation methods with no database involved,
// plus CouponPricingService.evaluateCoupon end-to-end against real Coupon /
// CouponProduct / CouponCategory / CouponRedemption / Order / User rows.
// No CartModels/CheckoutModels/OrderModels wiring exists yet — that is
// Module 2 — so nothing here touches cart, checkout, or order creation.
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { Category, Coupon, CouponCategory, CouponProduct, CouponRedemption, Order, Product, User } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { DATABASE_TABLE_NAMES } from "../../src/constants/database.constants.js";
import { CouponPricingService } from "../../src/models/CouponModels/coupon.service.js";
import { normalizeCouponCode } from "../../src/models/CouponModels/coupon.validation.js";
import type { CouponPricingLine } from "../../src/models/CouponModels/coupon.types.js";

describe("CouponPricingService — pure calculation (no database)", () => {
  describe("calculateDiscountPaise", () => {
    it("computes a percentage discount as floor(eligible × basisPoints / 10000)", () => {
      // 10% of ₹100.00 (10000 paise) = ₹10.00 (1000 paise), exact.
      expect(CouponPricingService.calculateDiscountPaise("percentage", 1000, 10_000, null)).toBe(1000);
    });

    it("floors a percentage discount instead of rounding", () => {
      // 999 × 3333 / 10000 = 332.9667 -> floors to 332, never 333.
      expect(CouponPricingService.calculateDiscountPaise("percentage", 3333, 999, null)).toBe(332);
    });

    it("applies the configured max-discount cap to a percentage coupon", () => {
      // 50% of ₹1000.00 (100000 paise) = ₹500.00 (50000 paise), capped to ₹200.00 (20000 paise).
      expect(CouponPricingService.calculateDiscountPaise("percentage", 5000, 100_000, 20_000)).toBe(20_000);
    });

    it("computes a fixed discount as min(fixedPaise, eligiblePaise)", () => {
      expect(CouponPricingService.calculateDiscountPaise("fixed", 2000, 5000, null)).toBe(2000);
    });

    it("never lets a fixed discount exceed eligible merchandise", () => {
      expect(CouponPricingService.calculateDiscountPaise("fixed", 2000, 1500, null)).toBe(1500);
    });

    it("applies a cap to a fixed discount too, if one is configured", () => {
      expect(CouponPricingService.calculateDiscountPaise("fixed", 2000, 5000, 500)).toBe(500);
    });

    it("returns 0 for zero eligible merchandise regardless of type", () => {
      expect(CouponPricingService.calculateDiscountPaise("percentage", 1000, 0, null)).toBe(0);
      expect(CouponPricingService.calculateDiscountPaise("fixed", 500, 0, null)).toBe(0);
    });

    it("never returns a negative discount", () => {
      expect(CouponPricingService.calculateDiscountPaise("fixed", 100, 50, null)).toBeGreaterThanOrEqual(0);
    });
  });

  describe("calculateEligibleMerchandisePaise", () => {
    const lines: CouponPricingLine[] = [
      { productId: 1, categoryId: 10, unitPricePaise: 10_000, quantity: 1 }, // 10000
      { productId: 2, categoryId: 20, unitPricePaise: 5_000, quantity: 2 } // 10000
    ];

    it("sums every line when the coupon has no product/category restriction", () => {
      expect(CouponPricingService.calculateEligibleMerchandisePaise(lines, null, null)).toBe(20_000);
    });

    it("counts only lines matching an eligible-product allowlist", () => {
      expect(CouponPricingService.calculateEligibleMerchandisePaise(lines, new Set([1]), null)).toBe(10_000);
    });

    it("counts only lines matching an eligible-category allowlist", () => {
      expect(CouponPricingService.calculateEligibleMerchandisePaise(lines, null, new Set([20]))).toBe(10_000);
    });

    it("combines product and category allowlists with OR, not AND", () => {
      // Product allowlist matches line 1 (productId 1); category allowlist
      // matches line 2 (categoryId 20) even though its productId (2) isn't
      // in the product allowlist — both lines must count.
      expect(CouponPricingService.calculateEligibleMerchandisePaise(lines, new Set([1]), new Set([20]))).toBe(20_000);
    });

    it("returns 0 when a restriction matches nothing", () => {
      expect(CouponPricingService.calculateEligibleMerchandisePaise(lines, new Set([999]), new Set([999]))).toBe(0);
    });
  });

  it("normalizeCouponCode trims and upper-cases", () => {
    expect(normalizeCouponCode("  save10 ")).toBe("SAVE10");
  });
});

describe("CouponPricingService.evaluateCoupon (database)", () => {
  const createdCouponIds: number[] = [];
  const createdOrderIds: number[] = [];
  const createdProductIds: number[] = [];
  const createdCategoryIds: number[] = [];
  const createdUserIds: number[] = [];

  async function createCategory(name: string): Promise<number> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.categories, t);
      await Category.create({ id, name, slug: `coupon-test-${id}`, pet_type: "all" }, { transaction: t });
      createdCategoryIds.push(id);
      return id;
    });
  }

  async function createProduct(categoryId: number, priceRupees: string): Promise<number> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.products, t);
      await Product.create(
        {
          id,
          category_id: categoryId,
          name: `Coupon test product ${id}`,
          slug: `coupon-test-product-${id}`,
          sku: `COUPON-TEST-${id}`,
          description: "Coupon test fixture product.",
          price: priceRupees,
          status: "active"
        } as any,
        { transaction: t }
      );
      createdProductIds.push(id);
      return id;
    });
  }

  async function createUser(email: string): Promise<number> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.users, t);
      await User.create(
        {
          id,
          name: "Coupon Test Customer",
          email,
          password_hash: "$2b$10$test.hash.not.a.real.bcrypt.hash.......",
          role: "customer",
          status: "active",
          reference_code: `CUS-${id}`
        } as any,
        { transaction: t }
      );
      createdUserIds.push(id);
      return id;
    });
  }

  async function createOrder(userId: number | null, paymentStatus: "pending" | "paid"): Promise<number> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.orders, t);
      await Order.create(
        {
          id,
          order_number: `COUPON-TEST-${id}`,
          user_id: userId,
          payment_status: paymentStatus,
          ship_recipient_name: "Coupon Test",
          ship_phone: "9999999999",
          ship_line_1: "1 Test Street",
          ship_city: "Chennai",
          ship_state: "Tamil Nadu",
          ship_postal_code: "600001"
        } as any,
        { transaction: t }
      );
      createdOrderIds.push(id);
      return id;
    });
  }

  async function createCoupon(overrides: Partial<Parameters<typeof Coupon.create>[0]> = {}): Promise<Coupon> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.coupons, t);
      const coupon = await Coupon.create(
        {
          id,
          code: `CPNTEST${id}`,
          name: `Coupon test ${id}`,
          discount_type: "percentage",
          discount_value: 1000,
          status: "active",
          ...overrides
        } as any,
        { transaction: t }
      );
      createdCouponIds.push(coupon.id);
      return coupon;
    });
  }

  async function createRedemption(coupon: Coupon, orderId: number, userId: number | null, status: "reserved" | "consumed" | "released"): Promise<void> {
    await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.couponRedemptions, t);
      await CouponRedemption.create(
        {
          id,
          coupon_id: coupon.id,
          order_id: orderId,
          user_id: userId,
          code_snapshot: coupon.code,
          discount_type_snapshot: coupon.discount_type,
          discount_value_snapshot: coupon.discount_value,
          eligible_merchandise_paise: 10_000,
          discount_amount_paise: 1000,
          status
        } as any,
        { transaction: t }
      );
    });
  }

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await CouponRedemption.destroy({ where: { coupon_id: createdCouponIds }, force: true });
    await CouponProduct.destroy({ where: { coupon_id: createdCouponIds }, force: true });
    await CouponCategory.destroy({ where: { coupon_id: createdCouponIds }, force: true });
    await Coupon.destroy({ where: { id: createdCouponIds }, force: true });
    await Order.destroy({ where: { id: createdOrderIds }, force: true });
    await Product.destroy({ where: { id: createdProductIds }, force: true });
    await Category.destroy({ where: { id: createdCategoryIds }, force: true });
    await User.destroy({ where: { id: createdUserIds }, force: true });
    await disconnectDatabase();
  });

  it("returns not_found for an unknown code (no-coupon behavior never throws)", async () => {
    const result = await CouponPricingService.evaluateCoupon({
      code: "DOES-NOT-EXIST-XYZ",
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("applies a percentage discount, case/whitespace-insensitively", async () => {
    const coupon = await createCoupon({ discount_type: "percentage", discount_value: 1000 } as any); // 10%
    const result = await CouponPricingService.evaluateCoupon({
      code: ` ${coupon.code.toLowerCase()} `,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 100_00, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.eligibleMerchandisePaise).toBe(10_000);
      expect(result.discountAmountPaise).toBe(1000);
      expect(result.codeSnapshot).toBe(coupon.code);
    }
  });

  it("applies a fixed discount", async () => {
    const coupon = await createCoupon({ discount_type: "fixed", discount_value: 1500 } as any);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 5000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.discountAmountPaise).toBe(1500);
  });

  it("rejects a draft coupon", async () => {
    const coupon = await createCoupon({ status: "draft" } as any);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_active");
  });

  it("rejects an inactive coupon", async () => {
    const coupon = await createCoupon({ status: "inactive" } as any);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_active");
  });

  it("rejects a coupon that has not started yet (starts_at in the future)", async () => {
    const futureStart = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const coupon = await createCoupon({ starts_at: futureStart } as any);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_started");
  });

  it("rejects an expired coupon (ends_at exclusive, in the past)", async () => {
    const pastEnd = new Date(Date.now() - 1000);
    const coupon = await createCoupon({ ends_at: pastEnd } as any);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("accepts a coupon exactly at its start boundary and before its end boundary", async () => {
    const startsAt = new Date(Date.now() - 1000);
    const endsAt = new Date(Date.now() + 60 * 60 * 1000);
    const coupon = await createCoupon({ starts_at: startsAt, ends_at: endsAt } as any);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(true);
  });

  it("rejects an order below the coupon's minimum eligible amount", async () => {
    const coupon = await createCoupon({ min_eligible_amount_paise: 50_000 } as any);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("below_minimum");
  });

  it("restricts eligibility to an allowlisted product, and rejects when no line matches", async () => {
    const categoryId = await createCategory("Coupon Test Category A");
    const eligibleProductId = await createProduct(categoryId, "100.00");
    const ineligibleProductId = await createProduct(categoryId, "50.00");
    const coupon = await createCoupon({ discount_type: "percentage", discount_value: 1000 } as any);
    await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.couponProducts, t);
      await CouponProduct.create({ id, coupon_id: coupon.id, product_id: eligibleProductId } as any, { transaction: t });
    });

    const matching = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [
        { productId: eligibleProductId, categoryId, unitPricePaise: 10_000, quantity: 1 },
        { productId: ineligibleProductId, categoryId, unitPricePaise: 5_000, quantity: 1 }
      ],
      identity: { userId: null }
    });
    expect(matching.ok).toBe(true);
    if (matching.ok) expect(matching.eligibleMerchandisePaise).toBe(10_000); // only the eligible line

    const nonMatching = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: ineligibleProductId, categoryId, unitPricePaise: 5_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(nonMatching.ok).toBe(false);
    if (!nonMatching.ok) expect(nonMatching.reason).toBe("no_eligible_items");
  });

  it("restricts eligibility to an allowlisted category", async () => {
    const eligibleCategoryId = await createCategory("Coupon Test Category B");
    const ineligibleCategoryId = await createCategory("Coupon Test Category C");
    const productInEligibleCategory = await createProduct(eligibleCategoryId, "80.00");
    const productInIneligibleCategory = await createProduct(ineligibleCategoryId, "40.00");
    const coupon = await createCoupon({} as any);
    await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.couponCategories, t);
      await CouponCategory.create({ id, coupon_id: coupon.id, category_id: eligibleCategoryId } as any, { transaction: t });
    });

    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [
        { productId: productInEligibleCategory, categoryId: eligibleCategoryId, unitPricePaise: 8_000, quantity: 1 },
        { productId: productInIneligibleCategory, categoryId: ineligibleCategoryId, unitPricePaise: 4_000, quantity: 1 }
      ],
      identity: { userId: null }
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.eligibleMerchandisePaise).toBe(8_000);
  });

  it("rejects a guest applying a per-customer-limited coupon", async () => {
    const coupon = await createCoupon({ per_customer_limit: 1 } as any);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("guest_not_allowed_for_restricted_coupon");
  });

  it("rejects a guest applying a first-order-only coupon", async () => {
    const coupon = await createCoupon({ first_order_only: true } as any);
    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("guest_not_allowed_for_restricted_coupon");
  });

  it("enforces the global usage limit once reserved/consumed redemptions reach it", async () => {
    const coupon = await createCoupon({ usage_limit: 1 } as any);
    const orderId = await createOrder(null, "pending");
    await createRedemption(coupon, orderId, null, "reserved");

    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("usage_limit_reached");
  });

  it("does not count a released redemption against the usage limit", async () => {
    const coupon = await createCoupon({ usage_limit: 1 } as any);
    const orderId = await createOrder(null, "pending");
    await createRedemption(coupon, orderId, null, "released");

    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: null }
    });
    expect(result.ok).toBe(true);
  });

  it("enforces the per-customer limit for an authenticated customer", async () => {
    const userId = await createUser(`coupon-test-percustomer-${Date.now()}@example.com`);
    const coupon = await createCoupon({ per_customer_limit: 1 } as any);
    const orderId = await createOrder(userId, "paid");
    await createRedemption(coupon, orderId, userId, "consumed");

    const result = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId }
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("per_customer_limit_reached");
  });

  it("rejects first-order-only for a customer with a prior paid order, and accepts a customer with none", async () => {
    const returningCustomerId = await createUser(`coupon-test-returning-${Date.now()}@example.com`);
    await createOrder(returningCustomerId, "paid");
    const newCustomerId = await createUser(`coupon-test-new-${Date.now()}@example.com`);
    // A pending (unpaid) order must never count as a completed first order.
    await createOrder(newCustomerId, "pending");

    const coupon = await createCoupon({ first_order_only: true } as any);

    const returningResult = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: returningCustomerId }
    });
    expect(returningResult.ok).toBe(false);
    if (!returningResult.ok) expect(returningResult.reason).toBe("first_order_only_not_first_order");

    const newCustomerResult = await CouponPricingService.evaluateCoupon({
      code: coupon.code,
      lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
      identity: { userId: newCustomerId }
    });
    expect(newCustomerResult.ok).toBe(true);
  });

  it("assertCouponApplicable throws CouponNotApplicableError when the coupon does not apply", async () => {
    await expect(
      CouponPricingService.assertCouponApplicable({
        code: "DOES-NOT-EXIST-XYZ",
        lines: [{ productId: 1, categoryId: 1, unitPricePaise: 10_000, quantity: 1 }],
        identity: { userId: null }
      })
    ).rejects.toThrow();
  });
});
