/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { AuthSession, Category, Coupon, CouponCategory, CouponProduct, CouponRedemption, Order, Product, User } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { DATABASE_TABLE_NAMES } from "../../src/constants/database.constants.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

const URL = "/api/v1/admin/coupons";
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
const body = (code: string, overrides: Record<string, unknown> = {}) => ({ code, name: `${code} campaign`, discountType: "percentage", discountValue: 1000, maxDiscountPaise: 5000, minEligibleAmountPaise: 10000, startsAt: null, endsAt: null, usageLimit: 10, perCustomerLimit: 1, firstOrderOnly: false, eligibleProductIds: [], eligibleCategoryIds: [], ...overrides });

describe("Admin coupon API", () => {
  let superToken = "";
  let adminToken = "";
  let categoryId = 0;
  let productId = 0;
  let usedCouponId = 0;
  let historicalOrderId = 0;
  let historicalTotal = "";

  beforeAll(async () => {
    await connectDatabase();
    const hash = await PasswordService.hash("TestPass123!@#");
    for (const [id, role, email] of [[99701, "super_admin", "coupon-admin-super@example.com"], [99702, "admin", "coupon-admin-plain@example.com"]] as const) {
      await AuthSession.destroy({ where: { user_id: id }, force: true });
      await User.destroy({ where: { id }, force: true });
      const user = await User.create({ id, name: "Coupon API Admin", email, password_hash: hash, role, status: "active", reference_code: `${role === "super_admin" ? "SUP" : "ADM"}-${id}` });
      const { session } = await SessionService.createSession(user.id, "admin", null, null);
      const token = TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role, sessionType: "admin" });
      if (role === "super_admin") superToken = token; else adminToken = token;
    }
    categoryId = await sequelize.transaction(async (transaction) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.categories, transaction);
      await Category.create({ id, name: "Coupon API Category", slug: `coupon-api-${id}`, description: null, pet_type: "all", active: true, display_order: 0 }, { transaction });
      return id;
    });
    productId = await sequelize.transaction(async (transaction) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.products, transaction);
      await Product.create({ id, category_id: categoryId, name: "Coupon API Product", slug: `coupon-api-product-${id}`, sku: `COUPON-API-${id}`, brand: null, description: "test", pet_type: "all", status: "active", price: "100.00", compare_at_price: null, stock: 10, has_variants: false, featured: false, display_order: 0, tags: null, meta_title: null, meta_description: null, weight_grams: null, length_cm: null, width_cm: null, height_cm: null, how_to_use: null, care_instructions: null, safety_info: null }, { transaction });
      return id;
    });
  });

  afterAll(async () => {
    const coupons = await Coupon.findAll({ where: sequelize.where(sequelize.col("code"), "LIKE", "RB_%") });
    const ids = coupons.map((coupon) => coupon.id);
    await CouponRedemption.destroy({ where: { coupon_id: ids }, force: true });
    await Order.destroy({ where: { id: historicalOrderId }, force: true });
    await CouponProduct.destroy({ where: { coupon_id: ids }, force: true });
    await CouponCategory.destroy({ where: { coupon_id: ids }, force: true });
    await Coupon.destroy({ where: { id: ids }, force: true });
    await Product.destroy({ where: { id: productId }, force: true });
    await Category.destroy({ where: { id: categoryId }, force: true });
    await AuthSession.destroy({ where: { user_id: [99701, 99702] }, force: true });
    await User.destroy({ where: { id: [99701, 99702] }, force: true });
    await disconnectDatabase();
  });

  it("rejects unauthenticated access", async () => { expect((await request(app).get(URL)).status).toBe(401); });
  it("rejects a plain admin", async () => { expect((await request(app).get(URL).set(auth(adminToken))).status).toBe(403); });

  it("creates a percentage coupon with normalized code", async () => {
    const res = await request(app).post(URL).set(auth(superToken)).send(body("  rb_percent  ", { eligibleProductIds: [productId], eligibleCategoryIds: [categoryId] }));
    expect(res.status).toBe(201); expect(res.body.data).toMatchObject({ code: "RB_PERCENT", discountType: "percentage", eligibleProductIds: [productId], eligibleCategoryIds: [categoryId], status: "draft" });
  });

  it("creates a fixed coupon", async () => {
    const res = await request(app).post(URL).set(auth(superToken)).send(body("RB_FIXED", { discountType: "fixed", discountValue: 2500, maxDiscountPaise: null }));
    expect(res.status).toBe(201); expect(res.body.data.discountValue).toBe(2500);
  });

  it("lists coupons", async () => { const res = await request(app).get(URL).set(auth(superToken)); expect(res.status).toBe(200); expect(res.body.data.items.some((item: any) => item.code === "RB_PERCENT")).toBe(true); });
  it("searches coupons", async () => { const res = await request(app).get(`${URL}?search=RB_FIXED`).set(auth(superToken)); expect(res.status).toBe(200); expect(res.body.data.items.map((item: any) => item.code)).toEqual(["RB_FIXED"]); });

  it("filters by status", async () => {
    const created = await request(app).post(URL).set(auth(superToken)).send(body("RB_ACTIVE"));
    await request(app).patch(`${URL}/${created.body.data.id}/status`).set(auth(superToken)).send({ status: "active" });
    const res = await request(app).get(`${URL}?status=active`).set(auth(superToken));
    expect(res.status).toBe(200); expect(res.body.data.items.every((item: any) => item.status === "active")).toBe(true);
  });

  it("paginates coupons", async () => { const res = await request(app).get(`${URL}?page=1&pageSize=2`).set(auth(superToken)); expect(res.status).toBe(200); expect(res.body.data.items).toHaveLength(2); expect(res.body.data.totalPages).toBeGreaterThanOrEqual(2); });
  it("rejects invalid financial input", async () => { const res = await request(app).post(URL).set(auth(superToken)).send(body("RB_BAD_VALUE", { discountValue: 10001 })); expect(res.status).toBe(400); expect(res.body.error.errors.discountValue).toBeDefined(); });
  it("rejects an invalid validity window", async () => { const res = await request(app).post(URL).set(auth(superToken)).send(body("RB_BAD_DATES", { startsAt: "2026-10-02T00:00:00.000Z", endsAt: "2026-10-01T00:00:00.000Z" })); expect(res.status).toBe(400); expect(res.body.error.errors.endsAt).toBeDefined(); });
  it("rejects duplicate normalized codes", async () => { const res = await request(app).post(URL).set(auth(superToken)).send(body(" rb_fixed ", { discountType: "fixed", discountValue: 100, maxDiscountPaise: null })); expect(res.status).toBe(409); });
  it("validates product and category restrictions", async () => { const res = await request(app).post(URL).set(auth(superToken)).send(body("RB_BAD_PRODUCT", { eligibleProductIds: [2147483000] })); expect(res.status).toBe(422); });

  it("edits an unused coupon", async () => {
    const created = await request(app).post(URL).set(auth(superToken)).send(body("RB_EDIT"));
    const res = await request(app).patch(`${URL}/${created.body.data.id}`).set(auth(superToken)).send(body("RB_EDITED", { name: "Edited campaign", discountValue: 1500 }));
    expect(res.status).toBe(200); expect(res.body.data).toMatchObject({ code: "RB_EDITED", name: "Edited campaign", discountValue: 1500 });
  });

  it("rejects unsafe mutation after redemption history exists", async () => {
    const created = await request(app).post(URL).set(auth(superToken)).send(body("RB_USED")); usedCouponId = created.body.data.id;
    historicalOrderId = await sequelize.transaction(async (transaction) => {
      const orderId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.orders, transaction);
      const order = await Order.create({ id: orderId, order_number: `RB-ORDER-${orderId}`, user_id: null, guest_identity_hash: "a".repeat(64), guest_access_token_hash: "b".repeat(64), cart_id: null, contact_email: "guest@example.com", status: "pending", payment_status: "pending", fulfilment_status: "unfulfilled", commerce_exception: null, subtotal: "100.00", shipping_fee: "0.00", total: "90.00", coupon_id: usedCouponId, coupon_code_snapshot: "RB_USED", coupon_discount_type_snapshot: "percentage", coupon_discount_value_snapshot: 1000, coupon_eligible_merchandise_paise: 10000, coupon_discount_amount_paise: 1000, currency: "INR", ship_recipient_name: "Guest", ship_phone: "9876543210", ship_line_1: "1 Test Road", ship_line_2: null, ship_city: "Mumbai", ship_state: "Maharashtra", ship_postal_code: "400001", ship_country: "IN", ship_latitude: null, ship_longitude: null, cancelled_at: null }, { transaction });
      const redemptionId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.couponRedemptions, transaction);
      await CouponRedemption.create({ id: redemptionId, coupon_id: usedCouponId, order_id: order.id, user_id: null, guest_identity_hash: "a".repeat(64), code_snapshot: "RB_USED", discount_type_snapshot: "percentage", discount_value_snapshot: 1000, eligible_merchandise_paise: 10000, discount_amount_paise: 1000, status: "reserved", consumed_at: null, released_at: null }, { transaction });
      historicalTotal = order.total; return order.id;
    });
    const res = await request(app).patch(`${URL}/${usedCouponId}`).set(auth(superToken)).send(body("RB_USED", { discountValue: 2000 }));
    expect(res.status).toBe(409);
  });

  it("deactivates a used coupon safely", async () => { const res = await request(app).patch(`${URL}/${usedCouponId}/status`).set(auth(superToken)).send({ status: "inactive" }); expect(res.status).toBe(200); expect(res.body.data.status).toBe("inactive"); });
  it("returns persisted redemption history without customer details", async () => { const res = await request(app).get(`${URL}/${usedCouponId}/redemptions`).set(auth(superToken)); expect(res.status).toBe(200); expect(res.body.data.items[0]).toMatchObject({ orderId: historicalOrderId, status: "reserved", couponCodeSnapshot: "RB_USED", discountAmountPaise: 1000, customerType: "guest" }); expect(res.body.data.items[0]).not.toHaveProperty("email"); });
  it("does not mutate historical order snapshots on deactivation", async () => { const order = await Order.findByPk(historicalOrderId); expect(order).toMatchObject({ total: historicalTotal, coupon_code_snapshot: "RB_USED", coupon_discount_amount_paise: 1000 }); });
});
