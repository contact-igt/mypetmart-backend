/* eslint-disable */
// Product payment-method eligibility (migration 083): resolver, Checkout
// Preview, Order creation, payment entry points, order-time snapshot, and the
// interaction with coupon payment-method eligibility.
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
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { Cart } from "../../src/database/tables/CartTable/index.js";
import { CartItem } from "../../src/database/tables/CartItemTable/index.js";
import { Order } from "../../src/database/tables/OrderTable/index.js";
import { OrderItem } from "../../src/database/tables/OrderItemTable/index.js";
import { Payment } from "../../src/database/tables/PaymentTable/index.js";
import { Refund } from "../../src/database/tables/RefundTable/index.js";
import { ReturnRequest } from "../../src/database/tables/ReturnRequestTable/index.js";
import { Coupon, CouponRedemption } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { IThinkClient } from "../../src/models/ShipmentModels/ithink.client.js";
import { resolveCartPaymentMethods } from "../../src/models/ProductModels/product-payment-methods.js";

type Eligibility = "both" | "payu" | "cod";

const CART_URL = "/api/v1/storefront/cart";
const PREVIEW_URL = "/api/v1/storefront/checkout/preview";
const ORDERS_URL = "/api/v1/storefront/orders";
const ADDRESS = { recipientName: "Pay Method Test", phone: "9876543210", line1: "1 Test Road", city: "Mumbai", state: "Maharashtra", postalCode: "400001" };
const EMAIL = "pay-method@example.com";

let categoryId: number;
let counter = 0;

async function clearAll(): Promise<void> {
  await Refund.destroy({ where: {}, force: true });
  await ReturnRequest.destroy({ where: {}, force: true });
  await CouponRedemption.destroy({ where: {}, force: true });
  await Payment.destroy({ where: {}, force: true });
  await OrderItem.destroy({ where: {}, force: true });
  await Order.destroy({ where: {}, force: true });
  await Coupon.destroy({ where: {}, force: true });
  await CartItem.destroy({ where: {}, force: true });
  await Cart.destroy({ where: {}, force: true });
  await Product.destroy({ where: {}, force: true });
  await Category.destroy({ where: {}, force: true });
}

async function createProduct(eligibility?: Eligibility, price = "500.00"): Promise<Product> {
  counter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id, category_id: categoryId, name: `PM Product ${counter}`, slug: `pm-product-${counter}-${Date.now()}`, sku: `PM-${counter}-${Date.now()}`,
        description: "d", pet_type: "all", status: "active", price, compare_at_price: null, stock: 20, has_variants: false, featured: false,
        ...(eligibility ? { payment_method_eligibility: eligibility } : {})
      } as never,
      { transaction: t }
    );
  });
}

async function createCoupon(eligibility: Eligibility, discountPaise = 10_000): Promise<Coupon> {
  counter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("coupons", t);
    return Coupon.create({ id, code: `PMCPN${counter}`, name: `PM coupon ${counter}`, discount_type: "fixed", discount_value: discountPaise, status: "active", payment_method_eligibility: eligibility } as never, { transaction: t });
  });
}

async function guestWith(products: Product[], couponCode?: string) {
  const guest = request.agent(app);
  for (const product of products) await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
  if (couponCode) await guest.post(`${CART_URL}/coupon`).send({ code: couponCode });
  return guest;
}
const preview = (guest: ReturnType<typeof request.agent>, paymentMethod: "payu" | "cod") =>
  guest.post(PREVIEW_URL).send({ shippingAddress: ADDRESS, contactEmail: EMAIL, paymentMethod });
const order = (guest: ReturnType<typeof request.agent>, paymentMethod?: "payu" | "cod") =>
  guest.post(ORDERS_URL).send({ shippingAddress: ADDRESS, contactEmail: EMAIL, ...(paymentMethod ? { paymentMethod } : {}) });

describe("Product payment-method eligibility", () => {
  beforeAll(async () => { await connectDatabase(); await clearAll(); });
  afterAll(async () => { await clearAll(); await disconnectDatabase(); });
  beforeEach(async () => {
    await clearAll();
    categoryId = await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId("categories", t);
      return (await Category.create({ id, name: "PM Category", slug: `pm-cat-${Date.now()}-${counter}`, description: "d", pet_type: "all", active: true, display_order: 1 }, { transaction: t })).id;
    });
    vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["test-courier"]);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  describe("resolver (intersection)", () => {
    const line = (productId: number, eligibility: Eligibility) => ({ productId, productName: `P${productId}`, eligibility });
    it.each([
      [["both", "both"], ["payu", "cod"]],
      [["both", "payu"], ["payu"]],
      [["both", "cod"], ["cod"]],
      [["payu", "payu"], ["payu"]],
      [["cod", "cod"], ["cod"]]
    ] as const)("%j => %j", (eligibilities, expected) => {
      const result = resolveCartPaymentMethods(eligibilities.map((e, i) => line(i + 1, e)));
      expect(result.allowedPaymentMethods).toEqual(expected);
      expect(result.conflict).toBeNull();
    });
    it("payu + cod => conflict listing the incompatible items", () => {
      const result = resolveCartPaymentMethods([line(1, "both"), line(2, "payu"), line(3, "cod")]);
      expect(result.allowedPaymentMethods).toEqual([]);
      expect(result.conflict?.code).toBe("PAYMENT_METHOD_CONFLICT");
      expect(result.conflict?.incompatibleItems.map((i) => i.productId)).toEqual([2, 3]);
    });
  });

  it("an existing/new product defaults to both", async () => {
    const product = await createProduct();
    expect((await Product.findByPk(product.id))!.payment_method_eligibility).toBe("both");
  });

  it("checkout preview returns authoritative allowedPaymentMethods and blocks a disallowed method", async () => {
    const both = await createProduct("both"), payu = await createProduct("payu"), cod = await createProduct("cod");
    expect((await preview(await guestWith([both]), "cod")).body.data.allowedPaymentMethods).toEqual(["payu", "cod"]);

    const payuPreview = await preview(await guestWith([payu]), "cod");
    expect(payuPreview.body.data.allowedPaymentMethods).toEqual(["payu"]);
    expect(payuPreview.body.data.readiness.orderReady).toBe(false);
    expect(payuPreview.body.data.paymentMethodMessage).toMatch(/Cash on Delivery is not available/);

    const codPreview = await preview(await guestWith([cod]), "payu");
    expect(codPreview.body.data.allowedPaymentMethods).toEqual(["cod"]);
    expect(codPreview.body.data.readiness.orderReady).toBe(false);
    expect(codPreview.body.data.paymentMethodMessage).toMatch(/Online payment is not available/);

    const conflict = await preview(await guestWith([payu, cod]), "payu");
    expect(conflict.body.data.allowedPaymentMethods).toEqual([]);
    expect(conflict.body.data.paymentMethodConflict.code).toBe("PAYMENT_METHOD_CONFLICT");
    expect(conflict.body.data.readiness.orderReady).toBe(false);
  });

  it("cart updates recalculate allowed methods (remove / add)", async () => {
    const a = await createProduct("both"), b = await createProduct("payu"), c = await createProduct("cod");
    const guest = await guestWith([a, b]);
    expect((await preview(guest, "payu")).body.data.allowedPaymentMethods).toEqual(["payu"]);
    const cart = (await guest.get(CART_URL)).body.data;
    const bItem = cart.items.find((item: { productId: number }) => item.productId === b.id);
    await guest.delete(`${CART_URL}/items/${bItem.cartItemId}`);
    expect((await preview(guest, "payu")).body.data.allowedPaymentMethods).toEqual(["payu", "cod"]);
    await guest.post(`${CART_URL}/items`).send({ productId: b.id, quantity: 1 });
    await guest.post(`${CART_URL}/items`).send({ productId: c.id, quantity: 1 });
    expect((await preview(guest, "payu")).body.data.paymentMethodConflict?.code).toBe("PAYMENT_METHOD_CONFLICT");
  });

  it("order creation rejects the wrong product payment method (both directions)", async () => {
    const payu = await createProduct("payu"), cod = await createProduct("cod");
    const a = await order(await guestWith([payu]), "cod");
    expect(a.status).toBe(422);
    expect(a.body.error.code).toBe("PRODUCT_PAYMENT_METHOD_NOT_ALLOWED");
    const b = await order(await guestWith([cod]), "payu");
    expect(b.status).toBe(422);
    expect(b.body.error.code).toBe("PRODUCT_PAYMENT_METHOD_NOT_ALLOWED");
    expect(await Order.count()).toBe(0);
  });

  it("a conflicting cart creates no Order, OrderItem, CouponRedemption or Payment — even without paymentMethod", async () => {
    const payu = await createProduct("payu"), cod = await createProduct("cod");
    const coupon = await createCoupon("both");
    const guest = await guestWith([payu, cod], coupon.code);
    for (const method of [undefined, "payu", "cod"] as const) {
      const res = await order(guest, method);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PAYMENT_METHOD_CONFLICT");
      expect(res.body.error.details.incompatibleItems).toHaveLength(2);
    }
    expect(await Order.count()).toBe(0);
    expect(await OrderItem.count()).toBe(0);
    expect(await CouponRedemption.count()).toBe(0);
    expect(await Payment.count()).toBe(0);
  });

  it("the order-time eligibility is snapshotted on each OrderItem", async () => {
    const payu = await createProduct("payu"), both = await createProduct("both");
    const res = await order(await guestWith([payu, both]), "payu");
    expect(res.status).toBe(201);
    const items = await OrderItem.findAll({ where: { order_id: res.body.data.id }, order: [["product_id", "ASC"]] });
    expect(items.map((i) => i.product_payment_method_eligibility_snapshot).sort()).toEqual(["both", "payu"]);
  });

  describe("payment entry points re-check the order snapshot", () => {
    it("PayU-only order: COD confirmation rejected with no payment, stock, coupon or cart side effect; PayU amount = Order.total", async () => {
      const product = await createProduct("payu");
      const coupon = await createCoupon("both", 5_000);
      const guest = await guestWith([product], coupon.code);
      const created = await order(guest); // legacy client: no paymentMethod
      expect(created.status).toBe(201);
      const token = created.body.data.guestAccessToken;
      const cod = await guest.post("/api/v1/storefront/payments/cod").send({ guestAccessToken: token });
      expect(cod.status).toBe(422);
      expect(cod.body.error.code).toBe("PRODUCT_PAYMENT_METHOD_MISMATCH");
      expect(await Payment.count()).toBe(0);
      expect((await Product.findByPk(product.id))!.stock).toBe(20);
      expect((await CouponRedemption.findOne({ where: { order_id: created.body.data.id } }))!.status).toBe("reserved");
      expect((await Cart.findByPk((await Order.findByPk(created.body.data.id))!.cart_id!))!.status).toBe("active");

      const payu = await guest.post("/api/v1/storefront/payments/initiate").send({ guestAccessToken: token });
      expect(payu.status).toBe(200);
      const orderRow = await Order.findByPk(created.body.data.id);
      expect(payu.body.data.fields.amount).toBe(orderRow!.total);
      expect((await Payment.findOne({ where: { order_id: orderRow!.id } }))!.amount).toBe(orderRow!.total);
    });

    it("COD-only order: PayU and Breeze initiation rejected with no payment attempt; COD still works", async () => {
      const product = await createProduct("cod");
      const guest = await guestWith([product]);
      const created = await order(guest);
      const token = created.body.data.guestAccessToken;
      const payu = await guest.post("/api/v1/storefront/payments/initiate").send({ guestAccessToken: token });
      expect(payu.status).toBe(422);
      expect(payu.body.error.code).toBe("PRODUCT_PAYMENT_METHOD_MISMATCH");
      const breeze = await guest.post("/api/v1/storefront/payments/breeze/initiate").send({ guestAccessToken: token });
      expect(breeze.status).toBe(422);
      expect(breeze.body.error.code).toBe("PRODUCT_PAYMENT_METHOD_MISMATCH");
      expect(await Payment.count()).toBe(0);
      const cod = await guest.post("/api/v1/storefront/payments/cod").send({ guestAccessToken: token });
      expect(cod.status).toBe(200);
    });

    it("editing the Product after order creation does not change the pending order's payment contract", async () => {
      // both -> order -> product becomes cod-only: the order may still pay online.
      const flexible = await createProduct("both");
      const g1 = await guestWith([flexible]);
      const o1 = await order(g1);
      await Product.update({ payment_method_eligibility: "cod" }, { where: { id: flexible.id } });
      expect((await g1.post("/api/v1/storefront/payments/initiate").send({ guestAccessToken: o1.body.data.guestAccessToken })).status).toBe(200);

      // payu-only -> order -> product becomes both: the order still may not use COD.
      const prepaid = await createProduct("payu");
      const g2 = await guestWith([prepaid]);
      const o2 = await order(g2, "payu");
      await Product.update({ payment_method_eligibility: "both" }, { where: { id: prepaid.id } });
      const cod = await g2.post("/api/v1/storefront/payments/cod").send({ guestAccessToken: o2.body.data.guestAccessToken });
      expect(cod.status).toBe(422);
      expect(cod.body.error.code).toBe("PRODUCT_PAYMENT_METHOD_MISMATCH");

      // New carts use the current configuration.
      expect((await preview(await guestWith([flexible]), "payu")).body.data.allowedPaymentMethods).toEqual(["cod"]);
    });
  });

  describe("interaction with coupon payment-method eligibility", () => {
    it("COD-only product + PayU-only coupon: no impossible 'Pay Online & Save' alternative", async () => {
      const product = await createProduct("cod");
      const coupon = await createCoupon("payu");
      const withCoupon = await (await guestWith([product])).post(PREVIEW_URL).send({ shippingAddress: ADDRESS, contactEmail: EMAIL, paymentMethod: "cod", couponCode: coupon.code });
      expect(withCoupon.status).toBe(200);
      expect(withCoupon.body.data.coupon.eligible).toBe(false);
      expect(withCoupon.body.data.coupon.alternativeSaving).toBeUndefined();
      expect(withCoupon.body.data.totals.discountAmount).toBe("0.00");
    });

    it("PayU-only product + COD-only coupon: no impossible COD saving", async () => {
      const product = await createProduct("payu");
      const coupon = await createCoupon("cod");
      const res = await (await guestWith([product])).post(PREVIEW_URL).send({ shippingAddress: ADDRESS, contactEmail: EMAIL, paymentMethod: "payu", couponCode: coupon.code });
      expect(res.body.data.coupon.eligible).toBe(false);
      expect(res.body.data.coupon.alternativeSaving).toBeUndefined();
    });

    it("both-method product keeps the existing prepaid and COD saving offers", async () => {
      const product = await createProduct("both");
      const prepaid = await createCoupon("payu");
      const codOnly = await createCoupon("cod", 5_000);
      const a = await (await guestWith([product])).post(PREVIEW_URL).send({ shippingAddress: ADDRESS, contactEmail: EMAIL, paymentMethod: "cod", couponCode: prepaid.code });
      expect(a.body.data.coupon.alternativeSaving).toMatchObject({ eligiblePaymentMethod: "payu", discountAmountPaise: 10_000 });
      const b = await (await guestWith([product])).post(PREVIEW_URL).send({ shippingAddress: ADDRESS, contactEmail: EMAIL, paymentMethod: "payu", couponCode: codOnly.code });
      expect(b.body.data.coupon.alternativeSaving).toMatchObject({ eligiblePaymentMethod: "cod", discountAmountPaise: 5_000 });
    });

    it("a product restriction cannot be overridden by a coupon: PayU-only product + both coupon still rejects COD", async () => {
      const product = await createProduct("payu");
      const coupon = await createCoupon("both");
      const res = await order(await guestWith([product], coupon.code), "cod");
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PRODUCT_PAYMENT_METHOD_NOT_ALLOWED");
      expect(await CouponRedemption.count()).toBe(0);
    });
  });
});
