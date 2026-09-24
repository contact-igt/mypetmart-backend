/* eslint-disable */
// Module 2 (Cart, Checkout and Order Integration — see the Module 2 request)
// end-to-end tests: coupon apply/remove on the Cart, Checkout Preview's
// coupon breakdown, Order creation's atomic reservation + immutable
// snapshot + line-level discount allocation, and the redemption lifecycle
// (reserved -> consumed on payment/COD confirmation, reserved -> released on
// pending-Order cancellation), including a genuine concurrency test for the
// last-use race. Module 1's own pure-calculation/evaluateCoupon tests live in
// coupon-pricing.test.ts and are not repeated here.
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockedShippingConfig = vi.hoisted(() => ({
  provider: "ithink",
  accessToken: "test-access-token",
  secretKey: "test-secret-key",
  apiBaseUrl: "https://pre-alpha.ithinklogistics.com",
  trackingBaseUrl: "https://pre-alpha.ithinklogistics.com",
  storeId: "test-store",
  pickupAddressId: "test-pickup",
  returnAddressId: "test-return",
  originPincode: "400001",
  timeoutMs: 1_000,
  ready: true
}));

vi.mock("../../src/config/shipping.config.js", () => ({ shippingConfig: mockedShippingConfig }));

import { app } from "../../src/app.js";
import { paymentConfig } from "../../src/config/payment.config.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { Cart } from "../../src/database/tables/CartTable/index.js";
import { CartItem } from "../../src/database/tables/CartItemTable/index.js";
import { Address } from "../../src/database/tables/AddressTable/index.js";
import { Order } from "../../src/database/tables/OrderTable/index.js";
import { OrderItem } from "../../src/database/tables/OrderItemTable/index.js";
import { Payment } from "../../src/database/tables/PaymentTable/index.js";
import { Coupon, CouponProduct, CouponCategory, CouponRedemption } from "../../src/database/tables/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { buildPayuResponseHash } from "../../src/models/PaymentModels/payu-hash.util.js";
import { IThinkClient } from "../../src/models/ShipmentModels/ithink.client.js";
import { CouponPricingService } from "../../src/models/CouponModels/coupon.service.js";
import { CouponNotApplicableError } from "../../src/models/CouponModels/coupon.errors.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS_URL = "/api/v1/storefront/orders";
const CHECKOUT_URL = "/api/v1/storefront/checkout/preview";
const INITIATE_URL = "/api/v1/storefront/payments/initiate";
const COD_URL = "/api/v1/storefront/payments/cod";
const WEBHOOK_URL = "/api/v1/payments/payu/webhook";

let categoryId: number;
let skuCounter = 0;
let couponCounter = 0;

async function createCategory(): Promise<number> {
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    const category = await Category.create(
      {
        id,
        name: "Coupon E2E Category",
        slug: `coupon-e2e-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: "Category for coupon Module 2 tests",
        pet_type: "all",
        active: true,
        display_order: 1
      },
      { transaction: t }
    );
    return category.id;
  });
}

async function createSimpleProduct(overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id,
        category_id: categoryId,
        name: `Coupon E2E Product ${skuCounter}`,
        slug: `coupon-e2e-simple-${skuCounter}-${Date.now()}`,
        sku: `CPN-E2E-${skuCounter}-${Date.now()}`,
        description: "Simple product for coupon Module 2 tests",
        pet_type: "all",
        status: "active",
        price: "500.00",
        compare_at_price: null,
        stock: 50,
        has_variants: false,
        featured: false,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

function validAddressPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    recipientName: "Jordan Rivera",
    phone: "+91 98765 43210",
    line1: "221B Baker Street",
    city: "Mumbai",
    state: "Maharashtra",
    postalCode: "400001",
    ...overrides
  };
}

async function mintCustomerToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const user = await User.create({
    id,
    name: `Coupon E2E Customer ${id}`,
    email,
    password_hash: pwdHash,
    role: "customer",
    status: "active",
    reference_code: `CUS-${id}`
  });
  const { session } = await SessionService.createSession(user.id, "customer", null, null);
  return TokenService.generateAccessToken({
    sub: String(user.id),
    sessionId: String(session.id),
    role: "customer",
    sessionType: "customer"
  });
}

async function createCoupon(overrides: Partial<Record<string, unknown>> = {}): Promise<Coupon> {
  couponCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("coupons", t);
    return Coupon.create(
      {
        id,
        code: `CPNE2E${couponCounter}`,
        name: `Coupon E2E ${couponCounter}`,
        discount_type: "percentage",
        discount_value: 1000, // 10%
        status: "active",
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

describe("Coupon Module 2 — Cart, Checkout, Order Integration", () => {
  let customerToken: string;
  let customerUserId: number;

  beforeAll(async () => {
    await connectDatabase();
    // A prior interrupted run can leave a stale fixture user behind with
    // dependent Address/Cart/Order rows still attached — clear every
    // dependent table (same FK order as afterAll/beforeEach below) before
    // removing the user itself, or the User delete fails on
    // fk_addresses_user_id.
    await CouponRedemption.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await CouponProduct.destroy({ where: {}, force: true });
    await CouponCategory.destroy({ where: {}, force: true });
    await Coupon.destroy({ where: {}, force: true });
    await CartItem.destroy({ where: {}, force: true });
    await Cart.destroy({ where: {}, force: true });
    await Address.destroy({ where: {}, force: true });
    const existing = await User.findOne({ where: { id: 99601 }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    customerUserId = 99601;
    customerToken = await mintCustomerToken(customerUserId, "coupon-e2e-customer@example.com");
  });

  afterAll(async () => {
    // Order.coupon_id is ON DELETE RESTRICT (immutable financial snapshot —
    // see migration 079) — Orders referencing a Coupon must be deleted
    // before that Coupon, not after.
    await CouponRedemption.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await CouponProduct.destroy({ where: {}, force: true });
    await CouponCategory.destroy({ where: {}, force: true });
    await Coupon.destroy({ where: {}, force: true });
    await CartItem.destroy({ where: {}, force: true });
    await Cart.destroy({ where: {}, force: true });
    await Address.destroy({ where: {}, force: true });
    await ProductImage.destroy({ where: {}, force: true });
    await ProductVariant.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: { user_id: customerUserId }, force: true });
    await User.destroy({ where: { id: customerUserId }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    // Same FK ordering requirement as afterAll above.
    await CouponRedemption.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await CouponProduct.destroy({ where: {}, force: true });
    await CouponCategory.destroy({ where: {}, force: true });
    await Coupon.destroy({ where: {}, force: true });
    await CartItem.destroy({ where: {}, force: true });
    await Cart.destroy({ where: {}, force: true });
    await Address.destroy({ where: {}, force: true });
    await ProductVariant.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    categoryId = await createCategory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // Cart apply / remove
  // -------------------------------------------------------------------
  describe("Cart coupon apply/remove", () => {
    it("applies a valid coupon to the customer's Cart and returns an authoritative discount breakdown", async () => {
      const coupon = await createCoupon({ discount_type: "fixed", discount_value: 5000 }); // ₹50 flat
      const product = await createSimpleProduct({ price: "500.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });

      const res = await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      expect(res.status).toBe(200);
      expect(res.body.data.coupon).toMatchObject({ code: coupon.code, eligible: true, discountAmount: "50.00" });

      // No redemption is ever created by Apply — only by Order creation.
      expect(await CouponRedemption.count({ where: { coupon_id: coupon.id } })).toBe(0);
    });

    it("rejects applying an unknown coupon code", async () => {
      const product = await createSimpleProduct();
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });

      const res = await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: "NOSUCHCODE" });
      expect(res.status).toBe(422);
    });

    it("repeated Apply requests for the same code are idempotent and never create a redemption", async () => {
      const coupon = await createCoupon();
      const product = await createSimpleProduct();
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });

      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      const second = await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      expect(second.status).toBe(200);
      expect(second.body.data.coupon.code).toBe(coupon.code);
      expect(await CouponRedemption.count({ where: { coupon_id: coupon.id } })).toBe(0);

      const carts = await Cart.findAll({ where: { user_id: customerUserId, status: "active" } });
      expect(carts).toHaveLength(1);
    });

    it("removes an applied coupon", async () => {
      const coupon = await createCoupon();
      const product = await createSimpleProduct();
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });

      const res = await request(app).delete(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.coupon).toBeNull();
    });

    it("re-evaluates an applied coupon live: it becomes ineligible (but stays applied) if the cart total drops below the minimum", async () => {
      const coupon = await createCoupon({ min_eligible_amount_paise: 100_000 }); // ₹1000 minimum
      const product = await createSimpleProduct({ price: "500.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });

      const applyRes = await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      expect(applyRes.status).toBe(422); // never eligible in the first place at qty 1 — apply itself fails

      // Applying succeeds once the minimum is met...
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 }); // total now 1000
      const secondApply = await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      expect(secondApply.status).toBe(200);
      expect(secondApply.body.data.coupon.eligible).toBe(true);

      // ...and shows as ineligible (without being dropped) once a quantity change breaks the minimum again.
      const cartGet = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerToken}`);
      const cartItemId = cartGet.body.data.items[0].cartItemId;
      const patchRes = await request(app).patch(`${CART_URL}/items/${cartItemId}`).set("Authorization", `Bearer ${customerToken}`).send({ quantity: 1 });
      expect(patchRes.body.data.coupon).toMatchObject({ code: coupon.code, eligible: false });
    });
  });

  // -------------------------------------------------------------------
  // Cart merge
  // -------------------------------------------------------------------
  describe("Cart merge coupon policy", () => {
    it("does not carry a guest cart's applied coupon over onto the customer cart on merge", async () => {
      const coupon = await createCoupon();
      const product = await createSimpleProduct();

      const guestAgent = request.agent(app);
      await guestAgent.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
      const guestApply = await guestAgent.post(`${CART_URL}/coupon`).send({ code: coupon.code });
      expect(guestApply.status).toBe(200);

      const mergeRes = await guestAgent.post(`${CART_URL}/merge`).set("Authorization", `Bearer ${customerToken}`);
      expect(mergeRes.status).toBe(200);
      expect(mergeRes.body.data.cart.coupon).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Checkout preview
  // -------------------------------------------------------------------
  describe("Checkout Preview coupon breakdown", () => {
    it("returns the full breakdown for an applied coupon", async () => {
      const coupon = await createCoupon({ discount_type: "fixed", discount_value: 10_000 }); // ₹100
      const product = await createSimpleProduct({ price: "500.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 2 }); // 1000
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());

      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ savedAddressId: address.body.data.id, billingSameAsShipping: true });

      expect(res.status).toBe(200);
      expect(res.body.data.totals).toMatchObject({
        merchandiseSubtotal: "1000.00",
        eligibleMerchandiseSubtotal: "1000.00",
        shippingAmount: "0.00",
        totalBeforeDiscount: "1000.00",
        discountAmount: "100.00",
        payableTotal: "900.00"
      });
      expect(res.body.data.coupon).toMatchObject({ code: coupon.code, eligible: true });
    });

    it("matches pre-coupon totals exactly when no coupon is applied (regression)", async () => {
      const product = await createSimpleProduct({ price: "500.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());

      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ savedAddressId: address.body.data.id, billingSameAsShipping: true });

      expect(res.status).toBe(200);
      expect(res.body.data.totals).toMatchObject({
        merchandiseSubtotal: "500.00",
        shippingAmount: "0.00",
        totalBeforeDiscount: "500.00",
        discountAmount: "0.00",
        payableTotal: "500.00"
      });
      expect(res.body.data.coupon).toBeNull();
    });

    it("revalidates and reports ineligibility when the cart changed since the coupon was applied", async () => {
      const coupon = await createCoupon({ min_eligible_amount_paise: 200_000 });
      const product = await createSimpleProduct({ price: "500.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 5 }); // 2500 >= 2000
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());

      const cartGet = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerToken}`);
      const cartItemId = cartGet.body.data.items[0].cartItemId;
      await request(app).patch(`${CART_URL}/items/${cartItemId}`).set("Authorization", `Bearer ${customerToken}`).send({ quantity: 1 }); // 500 < 2000

      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ savedAddressId: address.body.data.id, billingSameAsShipping: true });

      expect(res.body.data.coupon).toMatchObject({ eligible: false });
      expect(res.body.data.totals.discountAmount).toBe("0.00");
    });
  });

  // -------------------------------------------------------------------
  // Order creation
  // -------------------------------------------------------------------
  describe("Order creation with a coupon", () => {
    it("persists an immutable coupon snapshot and exact line-level discount allocation summing to the total discount", async () => {
      const coupon = await createCoupon({ discount_type: "fixed", discount_value: 10_000 }); // ₹100
      const productA = await createSimpleProduct({ price: "300.00" });
      const productB = await createSimpleProduct({ price: "700.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: productA.id, quantity: 1 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: productB.id, quantity: 1 });
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());

      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
      expect(orderRes.status).toBe(201);
      expect(orderRes.body.data.coupon).toMatchObject({ code: coupon.code, discountAmount: "100.00" });
      expect(orderRes.body.data.total).toBe("900.00"); // 1000 subtotal + 0 shipping - 100 discount
      expect(orderRes.body.data.totalBeforeDiscount).toBe("1000.00");

      const items = orderRes.body.data.items as Array<{ discountAllocated: string; lineTotal: string }>;
      const allocatedPaise = items.reduce((sum, item) => sum + Math.round(parseFloat(item.discountAllocated) * 100), 0);
      expect(allocatedPaise).toBe(10_000);

      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderRes.body.data.id } });
      expect(redemption).not.toBeNull();
      expect(redemption!.status).toBe("reserved");
    });

    it("fails Order creation if the coupon became invalid between Apply and Order creation, never silently dropping the discount", async () => {
      const coupon = await createCoupon();
      const product = await createSimpleProduct({ price: "500.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());

      await coupon.update({ status: "inactive" });

      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
      expect(orderRes.status).toBe(422);
      expect(await Order.count({ where: { user_id: customerUserId } })).toBe(0);
    });

    it("produces byte-for-byte identical totals to the pre-coupon behavior when no coupon is used (regression)", async () => {
      const product = await createSimpleProduct({ price: "500.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());

      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
      expect(orderRes.status).toBe(201);
      expect(orderRes.body.data.subtotal).toBe("500.00");
      expect(orderRes.body.data.shippingFee).toBe("0.00");
      expect(orderRes.body.data.total).toBe("500.00");
      expect(orderRes.body.data.totalBeforeDiscount).toBe("500.00");
      expect(orderRes.body.data.coupon).toBeNull();
      expect(orderRes.body.data.items[0].discountAllocated).toBe("0.00");
    });

    it("two concurrent Order creations racing for a coupon's last remaining use: exactly one succeeds", async () => {
      const coupon = await createCoupon({ usage_limit: 1 });

      const secondCustomerId = 99602;
      const existing = await User.findOne({ where: { id: secondCustomerId }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await Address.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
      const secondToken = await mintCustomerToken(secondCustomerId, "coupon-e2e-customer-2@example.com");

      const productA = await createSimpleProduct({ price: "500.00" });
      const productB = await createSimpleProduct({ price: "500.00" });

      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: productA.id, quantity: 1 });
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      const addressA = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());

      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${secondToken}`).send({ productId: productB.id, quantity: 1 });
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${secondToken}`).send({ code: coupon.code });
      const addressB = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${secondToken}`).send(validAddressPayload());

      const [resA, resB] = await Promise.all([
        request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: addressA.body.data.id }),
        request(app).post(ORDERS_URL).set("Authorization", `Bearer ${secondToken}`).send({ savedAddressId: addressB.body.data.id })
      ]);

      const statuses = [resA.status, resB.status].sort();
      expect(statuses).toEqual([201, 422]);

      const redemptions = await CouponRedemption.count({ where: { coupon_id: coupon.id, status: "reserved" } });
      expect(redemptions).toBe(1);

      // This test creates its own second customer with its own Order/Address
      // rows outside the describe-level beforeEach's blanket clear — clean
      // up in FK order (Order before Address/User; Cart.user_id is ON DELETE
      // SET NULL so it needs no pre-clean) rather than leaving it for the
      // next test's beforeEach, which never deletes Users.
      const secondCustomerOrderIds = (await Order.findAll({ where: { user_id: secondCustomerId }, attributes: ["id"] })).map((o) => o.id);
      await CouponRedemption.destroy({ where: { order_id: secondCustomerOrderIds }, force: true });
      await OrderItem.destroy({ where: { order_id: secondCustomerOrderIds }, force: true });
      await Payment.destroy({ where: { order_id: secondCustomerOrderIds }, force: true });
      await Order.destroy({ where: { user_id: secondCustomerId }, force: true });
      await Address.destroy({ where: { user_id: secondCustomerId }, force: true });
      await AuthSession.destroy({ where: { user_id: secondCustomerId }, force: true });
      await User.destroy({ where: { id: secondCustomerId }, force: true });
    });

    // Deterministic form of the staging race (MariaDB REPEATABLE READ): the
    // losing transaction has already taken its consistent-read snapshot
    // (createOrder reads cart/order rows before reaching the coupon lock)
    // when the winner commits. Its usage recount must still see the winner's
    // committed redemption, not the stale snapshot.
    it("final-use reservation recount sees a redemption committed after the loser's snapshot was taken", async () => {
      const coupon = await createCoupon({ usage_limit: 1 });

      const secondCustomerId = 99603;
      const existing = await User.findOne({ where: { id: secondCustomerId }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await Address.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
      const secondToken = await mintCustomerToken(secondCustomerId, "coupon-e2e-customer-3@example.com");

      async function placePlainOrder(token: string): Promise<number> {
        const product = await createSimpleProduct({ price: "500.00" });
        await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
        const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${token}`).send(validAddressPayload());
        const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${token}`).send({ savedAddressId: address.body.data.id });
        expect(res.status).toBe(201);
        return res.body.data.id as number;
      }
      const orderA = await placePlainOrder(customerToken);
      const orderB = await placePlainOrder(secondToken);

      const reservation = (orderId: number) => ({
        couponId: coupon.id, orderId, userId: null, guestIdentityHash: null, codeSnapshot: coupon.code,
        discountTypeSnapshot: coupon.discount_type, discountValueSnapshot: coupon.discount_value,
        eligibleMerchandisePaise: 50000, discountAmountPaise: 1000
      });

      const loser = await sequelize.transaction();
      try {
        // Establish the loser's snapshot before the winner commits.
        expect(await CouponRedemption.count({ where: { coupon_id: coupon.id }, transaction: loser })).toBe(0);

        await sequelize.transaction((winner) => CouponPricingService.reserveCouponForOrder(reservation(orderA), winner));

        await expect(CouponPricingService.reserveCouponForOrder(reservation(orderB), loser)).rejects.toBeInstanceOf(CouponNotApplicableError);
      } finally {
        await loser.rollback();
      }

      expect(await CouponRedemption.count({ where: { coupon_id: coupon.id, status: "reserved" } })).toBe(1);

      const secondCustomerOrderIds = (await Order.findAll({ where: { user_id: secondCustomerId }, attributes: ["id"] })).map((o) => o.id);
      await CouponRedemption.destroy({ where: { order_id: secondCustomerOrderIds }, force: true });
      await OrderItem.destroy({ where: { order_id: secondCustomerOrderIds }, force: true });
      await Payment.destroy({ where: { order_id: secondCustomerOrderIds }, force: true });
      await Order.destroy({ where: { user_id: secondCustomerId }, force: true });
      await Address.destroy({ where: { user_id: secondCustomerId }, force: true });
      await AuthSession.destroy({ where: { user_id: secondCustomerId }, force: true });
      await User.destroy({ where: { id: secondCustomerId }, force: true });
    });

    // The locking recount must keep every existing capacity rule intact on
    // the authoritative reservation path (not only in evaluateCoupon).
    it("reservation path: released frees capacity, consumed occupies it, per-customer limit holds, unlimited is unaffected", async () => {
      const customerIds = [99610, 99611, 99612, 99613, 99614, 99615, 99616];
      async function cleanupCustomers(): Promise<void> {
        const orderIds = (await Order.findAll({ where: { user_id: customerIds }, attributes: ["id"] })).map((o) => o.id);
        await CouponRedemption.destroy({ where: { order_id: orderIds }, force: true });
        await OrderItem.destroy({ where: { order_id: orderIds }, force: true });
        await Payment.destroy({ where: { order_id: orderIds }, force: true });
        await Order.destroy({ where: { user_id: customerIds }, force: true });
        await Address.destroy({ where: { user_id: customerIds }, force: true });
        await AuthSession.destroy({ where: { user_id: customerIds }, force: true });
        await User.destroy({ where: { id: customerIds }, force: true });
      }
      await cleanupCustomers();

      // One pending order per customer (a customer may hold only one).
      const orderIds: number[] = [];
      for (const id of customerIds) {
        const token = await mintCustomerToken(id, `coupon-e2e-cap-${id}@example.com`);
        const product = await createSimpleProduct({ price: "500.00" });
        await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
        const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${token}`).send(validAddressPayload());
        const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${token}`).send({ savedAddressId: address.body.data.id });
        expect(res.status).toBe(201);
        orderIds.push(res.body.data.id as number);
      }
      const [a, b, c, d, e, f, g] = orderIds as [number, number, number, number, number, number, number];
      const [firstCustomer, secondCustomer] = customerIds as [number, number, ...number[]];

      const reserve = (target: Coupon, orderId: number, userId: number | null = null) =>
        sequelize.transaction((t) => CouponPricingService.reserveCouponForOrder({
          couponId: target.id, orderId, userId, guestIdentityHash: null, codeSnapshot: target.code,
          discountTypeSnapshot: target.discount_type, discountValueSnapshot: target.discount_value,
          eligibleMerchandisePaise: 50000, discountAmountPaise: 1000
        }, t));

      // Global limit 1: a released reservation frees the use; a consumed one occupies it.
      const limited = await createCoupon({ usage_limit: 1 });
      await reserve(limited, a);
      await expect(reserve(limited, b)).rejects.toBeInstanceOf(CouponNotApplicableError);
      await sequelize.transaction((t) => CouponPricingService.releaseCouponReservation(a, t));
      await reserve(limited, b);
      await sequelize.transaction((t) => CouponPricingService.consumeCouponReservation(b, t));
      await expect(reserve(limited, c)).rejects.toBeInstanceOf(CouponNotApplicableError);

      // Per-customer limit 1 (no global limit): same customer rejected, another customer accepted.
      const perCustomer = await createCoupon({ usage_limit: null, per_customer_limit: 1 });
      await reserve(perCustomer, c, firstCustomer);
      await expect(reserve(perCustomer, d, firstCustomer)).rejects.toBeInstanceOf(CouponNotApplicableError);
      await reserve(perCustomer, d, secondCustomer);

      // Unlimited coupon: no capacity check applies.
      const unlimited = await createCoupon({ usage_limit: null, per_customer_limit: null });
      await reserve(unlimited, e);
      await reserve(unlimited, f);
      await reserve(unlimited, g);
      expect(await CouponRedemption.count({ where: { coupon_id: unlimited.id, status: "reserved" } })).toBe(3);

      await cleanupCustomers();
    }, 20000);

    // A returning guest reuses the same Cart row (keyed by the guest cookie)
    // once its previous order finalized it to "ordered". The new shopping
    // session must start without the previous order's coupon.
    it("a reactivated guest cart does not carry over the previous order's coupon", async () => {
      const coupon = await createCoupon();
      const first = await createSimpleProduct({ price: "500.00" });
      const next = await createSimpleProduct({ price: "300.00" });
      const guest = request.agent(app);

      const added = await guest.post(`${CART_URL}/items`).send({ productId: first.id, quantity: 1 });
      const applied = await guest.post(`${CART_URL}/coupon`).send({ code: coupon.code });
      expect(applied.body.data.coupon?.code).toBe(coupon.code);
      await Cart.update({ status: "ordered" }, { where: { id: added.body.data.id } });

      const reused = await guest.post(`${CART_URL}/items`).send({ productId: next.id, quantity: 1 });
      expect(reused.status).toBe(201);
      expect(reused.body.data.id).toBe(added.body.data.id);
      expect(reused.body.data.coupon).toBeNull();
      expect((await Cart.findByPk(added.body.data.id))?.coupon_id).toBeNull();
    });
  });

  // -------------------------------------------------------------------
  // Redemption lifecycle
  // -------------------------------------------------------------------
  describe("Redemption lifecycle", () => {
    async function placeOrderWithCoupon(coupon: Coupon): Promise<{ orderId: number; productId: number }> {
      const product = await createSimpleProduct({ price: "500.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());
      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
      return { orderId: orderRes.body.data.id, productId: product.id };
    }

    it("releases the reservation when a pending Order is cancelled", async () => {
      const coupon = await createCoupon();
      const { orderId } = await placeOrderWithCoupon(coupon);

      const cancelRes = await request(app).post(`${ORDERS_URL}/${orderId}/cancel`).set("Authorization", `Bearer ${customerToken}`);
      expect(cancelRes.status).toBe(200);

      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("released");
    });

    it("consumes the reservation once a PayU payment is verified successful", async () => {
      const coupon = await createCoupon();
      const { orderId } = await placeOrderWithCoupon(coupon);

      const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields = initRes.body.data.fields;
      const hash = buildPayuResponseHash(
        { key: fields.key, txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, status: "success" },
        paymentConfig.payuSalt as string
      );
      await request(app)
        .post(WEBHOOK_URL)
        .type("form")
        .send({
          status: "success",
          txnid: fields.txnid,
          amount: fields.amount,
          productinfo: fields.productinfo,
          firstname: fields.firstname,
          email: fields.email,
          udf1: fields.udf1,
          mihpayid: `mihpay_${fields.txnid}`,
          mode: "UPI",
          hash
        });

      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("consumed");
    });

    it("consumes the reservation once a COD Order is confirmed", async () => {
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["test-courier"]);
      const coupon = await createCoupon();
      const { orderId } = await placeOrderWithCoupon(coupon);

      const codRes = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      expect(codRes.status, JSON.stringify(codRes.body)).toBe(200);

      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("consumed");
    });
  });
});
