/* eslint-disable */
// Module 3 (Payment and Redemption Lifecycle) tests. PayU success, COD
// confirmation, the concurrent-final-use race, and the no-coupon regression
// at the order/checkout level are already covered end-to-end in
// coupon-checkout-order.test.ts (Module 2) — this file covers the
// Module-3-specific scenarios: Breeze success (via the same shared
// finalization transaction PayU and Breeze both converge on), duplicate
// callbacks, failed-payment-then-retry, cancellation-vs-payment-success
// races, and partial/full refund amounts computed from the persisted
// line-discount snapshot rather than the coupon's current configuration.
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
import { Cart } from "../../src/database/tables/CartTable/index.js";
import { CartItem } from "../../src/database/tables/CartItemTable/index.js";
import { Address } from "../../src/database/tables/AddressTable/index.js";
import { Order } from "../../src/database/tables/OrderTable/index.js";
import { OrderItem } from "../../src/database/tables/OrderItemTable/index.js";
import { Payment } from "../../src/database/tables/PaymentTable/index.js";
import { Refund } from "../../src/database/tables/RefundTable/index.js";
import { ReturnRequest } from "../../src/database/tables/ReturnRequestTable/index.js";
import { Coupon, CouponRedemption } from "../../src/database/tables/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { buildPayuResponseHash } from "../../src/models/PaymentModels/payu-hash.util.js";
import { PaymentFinalizationService } from "../../src/models/PaymentModels/payment-finalization.service.js";
import { RefundService } from "../../src/models/RefundModels/refund.service.js";
import { IThinkClient } from "../../src/models/ShipmentModels/ithink.client.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS_URL = "/api/v1/storefront/orders";
const ADMIN_ORDERS_URL = "/api/v1/admin/orders";
const RETURNS_URL = "/api/v1/storefront/returns";
const ADMIN_RETURNS_URL = "/api/v1/admin/returns";
const INITIATE_URL = "/api/v1/storefront/payments/initiate";
const WEBHOOK_URL = "/api/v1/payments/payu/webhook";
const cancelUrl = (orderId: number | string) => `${ORDERS_URL}/${orderId}/cancel`;

let categoryId: number;
let skuCounter = 0;
let couponCounter = 0;

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response;
}

async function createCategory(): Promise<number> {
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    const category = await Category.create(
      { id, name: "Coupon Payment Test Category", slug: `coupon-payment-cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, description: "d", pet_type: "all", active: true, display_order: 1 },
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
        name: `Coupon Payment Test Product ${skuCounter}`,
        slug: `coupon-payment-simple-${skuCounter}-${Date.now()}`,
        sku: `CPN-PAY-${skuCounter}-${Date.now()}`,
        description: "d",
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
  return { recipientName: "Jordan Rivera", phone: "+91 98765 43210", line1: "221B Baker Street", city: "Mumbai", state: "Maharashtra", postalCode: "400001", ...overrides };
}

async function mintToken(id: number, email: string, role: "customer" | "admin" | "super_admin"): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const sessionType = role === "customer" ? "customer" : "admin";
  const user = await User.create({ id, name: `Coupon Payment Test User ${id}`, email, password_hash: pwdHash, role, status: "active", reference_code: `USR-${id}` });
  const { session } = await SessionService.createSession(user.id, sessionType, null, null);
  return TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role, sessionType });
}

async function createCoupon(overrides: Partial<Record<string, unknown>> = {}): Promise<Coupon> {
  couponCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("coupons", t);
    return Coupon.create(
      { id, code: `CPNPAY${couponCounter}`, name: `Coupon Payment Test ${couponCounter}`, discount_type: "fixed", discount_value: 10_000, status: "active", ...overrides } as never,
      { transaction: t }
    );
  });
}

describe("Coupon Module 3 — Payment and Redemption Lifecycle", () => {
  let customerToken: string;
  let adminToken: string;
  let superAdminToken: string;
  const CUSTOMER_ID = 99701;
  const ADMIN_ID = 99702;
  const SUPER_ADMIN_ID = 99703;

  beforeAll(async () => {
    await connectDatabase();
    // Same rationale as coupon-checkout-order.test.ts's beforeAll: a prior
    // interrupted run can leave stale fixture users with dependent rows
    // still attached, which would otherwise fail the User delete below on
    // fk_addresses_user_id (and other FKs).
    await Refund.destroy({ where: {}, force: true });
    await ReturnRequest.destroy({ where: {}, force: true });
    await CouponRedemption.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await Coupon.destroy({ where: {}, force: true });
    await CartItem.destroy({ where: {}, force: true });
    await Cart.destroy({ where: {}, force: true });
    await Address.destroy({ where: {}, force: true });
    for (const id of [CUSTOMER_ID, ADMIN_ID, SUPER_ADMIN_ID]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }
    customerToken = await mintToken(CUSTOMER_ID, "coupon-payment-customer@example.com", "customer");
    adminToken = await mintToken(ADMIN_ID, "coupon-payment-admin@example.com", "admin");
    superAdminToken = await mintToken(SUPER_ADMIN_ID, "coupon-payment-super-admin@example.com", "super_admin");
  });

  afterAll(async () => {
    // Order.coupon_id is ON DELETE RESTRICT (immutable financial snapshot —
    // see migration 079) — Orders referencing a Coupon must be deleted
    // before that Coupon, not after.
    await Refund.destroy({ where: {}, force: true });
    await ReturnRequest.destroy({ where: {}, force: true });
    await CouponRedemption.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await Coupon.destroy({ where: {}, force: true });
    await CartItem.destroy({ where: {}, force: true });
    await Cart.destroy({ where: {}, force: true });
    await Address.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: { user_id: [CUSTOMER_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await User.destroy({ where: { id: [CUSTOMER_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Refund.destroy({ where: {}, force: true });
    await ReturnRequest.destroy({ where: {}, force: true });
    await CouponRedemption.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await Coupon.destroy({ where: {}, force: true });
    await CartItem.destroy({ where: {}, force: true });
    await Cart.destroy({ where: {}, force: true });
    await Address.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    categoryId = await createCategory();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function placeOrderWithCoupon(coupon: Coupon, overrides: { quantity?: number; price?: string } = {}): Promise<{ orderId: number; total: string }> {
    const product = await createSimpleProduct({ price: overrides.price ?? "500.00" });
    await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: overrides.quantity ?? 1 });
    await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
    const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());
    const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
    expect(orderRes.status).toBe(201);
    return { orderId: orderRes.body.data.id, total: orderRes.body.data.total };
  }

  // -------------------------------------------------------------------
  // Payment initiation
  // -------------------------------------------------------------------
  describe("Payment initiation uses Order.total only", () => {
    it("snapshots the PayU Payment Attempt's amount from the already-discounted Order.total, never recomputing from the coupon", async () => {
      const coupon = await createCoupon({ discount_type: "fixed", discount_value: 10_000 }); // ₹100 off
      const { orderId, total } = await placeOrderWithCoupon(coupon);
      expect(total).toBe("400.00"); // 500 - 100

      const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      expect(initRes.status).toBe(200);
      expect(initRes.body.data.fields.amount).toBe("400.00");

      const payment = await Payment.findOne({ where: { order_id: orderId } });
      expect(payment!.amount).toBe("400.00");
    });
  });

  // -------------------------------------------------------------------
  // Successful online payment (Breeze) + duplicate callbacks
  // -------------------------------------------------------------------
  describe("Successful payment consumes the reservation atomically", () => {
    it("Breeze: a verified SUCCESS result consumes the reservation within the same finalization transaction that confirms the Order", async () => {
      const coupon = await createCoupon();
      const { orderId, total } = await placeOrderWithCoupon(coupon);

      const breezeTxnId = `BRZ-${orderId}-${Date.now()}`;
      const paymentId = await sequelize.transaction(async (t) => {
        const id = await IdSequenceService.allocateNextId("payments", t);
        await Payment.create(
          { id, order_id: orderId, amount: total, currency: "INR", provider: "breeze", status: "pending", provider_order_id: breezeTxnId, provider_payment_id: null, method: null, raw_payload: null } as never,
          { transaction: t }
        );
        return id;
      });

      const outcome = await PaymentFinalizationService.processVerifiedPaymentResult({
        merchantTransactionId: breezeTxnId,
        providerPaymentId: `brz_pay_${paymentId}`,
        normalizedOutcome: "SUCCESS",
        amount: total,
        method: "UPI",
        verifiedVia: "webhook",
        verifiedAt: new Date(),
        providerStatus: "SUCCESS",
        safeMetadata: {}
      } as never);

      expect(outcome.code).toBe("SUCCESS_CONFIRMED");
      const order = await Order.findByPk(orderId);
      expect(order!.status).toBe("confirmed");
      expect(order!.payment_status).toBe("paid");

      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("consumed");
      expect(redemption!.consumed_at).not.toBeNull();
    });

    it("a duplicate PayU webhook delivery never consumes the coupon twice", async () => {
      const coupon = await createCoupon();
      const { orderId } = await placeOrderWithCoupon(coupon);

      const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields = initRes.body.data.fields;
      const buildBody = () => {
        const hash = buildPayuResponseHash(
          { key: fields.key, txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, status: "success" },
          paymentConfig.payuSalt as string
        );
        return { status: "success", txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, mihpayid: `mihpay_${fields.txnid}`, mode: "UPI", hash };
      };

      const first = await request(app).post(WEBHOOK_URL).type("form").send(buildBody());
      const second = await request(app).post(WEBHOOK_URL).type("form").send(buildBody());
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);

      const redemptions = await CouponRedemption.findAll({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemptions).toHaveLength(1);
      expect(redemptions[0]!.status).toBe("consumed");

      // Also verify the browser-return path (same webhook route, standing in
      // for the "verify payment" callback the browser triggers) is equally
      // idempotent — a third delivery still doesn't create a second row.
      const third = await request(app).post(WEBHOOK_URL).type("form").send(buildBody());
      expect(third.status).toBe(200);
      expect(await CouponRedemption.count({ where: { coupon_id: coupon.id, order_id: orderId } })).toBe(1);
    });

    it("COD confirmation consumes the reservation exactly once and does not alter stock/order-confirmation semantics", async () => {
      const serviceability = vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["test-courier"]);
      const coupon = await createCoupon();
      const product = await createSimpleProduct({ price: "500.00", stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 2 });
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());
      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
      const orderId = orderRes.body.data.id;
      const persistedTotal = orderRes.body.data.total;

      serviceability.mockResolvedValueOnce([]);
      const failedCod = await request(app).post("/api/v1/storefront/payments/cod").set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      expect(failedCod.status).toBe(422);
      expect((await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } }))!.status).toBe("reserved");
      expect((await Product.findByPk(product.id))!.stock).toBe(10);

      const codRes1 = await request(app).post("/api/v1/storefront/payments/cod").set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      expect(codRes1.status).toBe(200);
      expect((await Product.findByPk(product.id))!.stock).toBe(8); // decremented exactly once
      const consumedAt = (await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } }))!.consumed_at;
      expect(consumedAt).not.toBeNull();

      // A duplicate confirm request is the existing idempotent-replay path —
      // must not decrement stock again or touch the redemption again.
      const codRes2 = await request(app).post("/api/v1/storefront/payments/cod").set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      expect(codRes2.status).toBe(200);
      expect((await Product.findByPk(product.id))!.stock).toBe(8);

      const order = await Order.findByPk(orderId);
      expect(order!.status).toBe("confirmed");
      expect(order!.total).toBe(persistedTotal);
      expect(order!.payment_status).toBe("pending"); // COD design — unchanged by coupon wiring

      const redemptions = await CouponRedemption.findAll({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemptions).toHaveLength(1);
      expect(redemptions[0]!.status).toBe("consumed");
      expect(redemptions[0]!.consumed_at).toEqual(consumedAt);

      const noCouponProduct = await createSimpleProduct({ price: "100.00", stock: 3 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: noCouponProduct.id, quantity: 1 });
      const noCouponOrder = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
      const noCouponCod = await request(app).post("/api/v1/storefront/payments/cod").set("Authorization", `Bearer ${customerToken}`).send({ orderId: noCouponOrder.body.data.id });
      expect(noCouponCod.status).toBe(200);
      expect(await CouponRedemption.count({ where: { order_id: noCouponOrder.body.data.id } })).toBe(0);
    });
  });

  // -------------------------------------------------------------------
  // Failed payment + retry
  // -------------------------------------------------------------------
  describe("Failed payment followed by retry", () => {
    it("a failed attempt does not release the reservation or change the Order total; a subsequent successful retry consumes it", async () => {
      const coupon = await createCoupon({ discount_type: "fixed", discount_value: 10_000 });
      const { orderId, total } = await placeOrderWithCoupon(coupon);

      const initRes1 = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields1 = initRes1.body.data.fields;
      const failHash = buildPayuResponseHash(
        { key: fields1.key, txnid: fields1.txnid, amount: fields1.amount, productinfo: fields1.productinfo, firstname: fields1.firstname, email: fields1.email, udf1: fields1.udf1, status: "failure" },
        paymentConfig.payuSalt as string
      );
      await request(app)
        .post(WEBHOOK_URL)
        .type("form")
        .send({ status: "failure", txnid: fields1.txnid, amount: fields1.amount, productinfo: fields1.productinfo, firstname: fields1.firstname, email: fields1.email, udf1: fields1.udf1, mihpayid: `mihpay_${fields1.txnid}`, mode: "UPI", hash: failHash, error_Message: "Insufficient funds" });

      let order = await Order.findByPk(orderId);
      expect(order!.status).toBe("pending"); // still retryable
      expect(order!.payment_status).toBe("pending");
      expect(order!.total).toBe(total); // immutable, unchanged by the failed attempt

      let redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("reserved"); // NOT released — order remains pending/retryable

      // Retry: a fresh attempt is created since the previous one is terminal.
      const initRes2 = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields2 = initRes2.body.data.fields;
      expect(fields2.txnid).not.toBe(fields1.txnid);
      expect(fields2.amount).toBe(total); // same discounted amount on retry

      const successHash = buildPayuResponseHash(
        { key: fields2.key, txnid: fields2.txnid, amount: fields2.amount, productinfo: fields2.productinfo, firstname: fields2.firstname, email: fields2.email, udf1: fields2.udf1, status: "success" },
        paymentConfig.payuSalt as string
      );
      await request(app)
        .post(WEBHOOK_URL)
        .type("form")
        .send({ status: "success", txnid: fields2.txnid, amount: fields2.amount, productinfo: fields2.productinfo, firstname: fields2.firstname, email: fields2.email, udf1: fields2.udf1, mihpayid: `mihpay_${fields2.txnid}`, mode: "UPI", hash: successHash });

      order = await Order.findByPk(orderId);
      expect(order!.status).toBe("confirmed");
      expect(order!.payment_status).toBe("paid");
      expect(order!.total).toBe(total); // still unchanged

      redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("consumed");
      // Exactly one redemption row for this Order across both attempts.
      expect(await CouponRedemption.count({ where: { coupon_id: coupon.id, order_id: orderId } })).toBe(1);
    });
  });

  // -------------------------------------------------------------------
  // Cancellation vs payment-success races
  // -------------------------------------------------------------------
  describe("Cancellation vs payment-success races", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    it("releases the reservation only once reconciliation confirms the pending Order can safely be cancelled", async () => {
      const coupon = await createCoupon();
      const { orderId } = await placeOrderWithCoupon(coupon);

      const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields = initRes.body.data.fields;
      // PayU's own Verify API says this attempt never actually captured funds.
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ status: 1, transaction_details: { [fields.txnid]: { mihpayid: `mihpay_${fields.txnid}`, status: "failure", amt: fields.amount, mode: "UPI" } } })
      );

      const cancelRes = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerToken}`).send({});
      expect(cancelRes.status).toBe(200);
      expect(fetch).toHaveBeenCalled(); // reconciliation actually ran first

      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("released");
    });

    it("never releases the reservation when reconciliation finds the payment already captured — cancellation is rejected instead", async () => {
      const coupon = await createCoupon();
      const { orderId } = await placeOrderWithCoupon(coupon);

      const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields = initRes.body.data.fields;
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ status: 1, transaction_details: { [fields.txnid]: { mihpayid: `mihpay_${fields.txnid}`, status: "success", amt: fields.amount, mode: "UPI" } } })
      );

      const cancelRes = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerToken}`).send({});
      expect(cancelRes.status).toBe(409);
      expect(cancelRes.body.error.code).toBe("ORDER_ALREADY_PAID");

      const order = await Order.findByPk(orderId);
      expect(order!.status).not.toBe("cancelled");
      expect(order!.payment_status).toBe("paid");

      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("consumed"); // never released — the payment was in fact captured
    });

    it("a payment that finalizes to paid moments before the cancel request lands cannot end up with a released reservation", async () => {
      const coupon = await createCoupon();
      const { orderId } = await placeOrderWithCoupon(coupon);

      const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields = initRes.body.data.fields;
      // Simulate the webhook/finalization having already committed, as if it
      // raced ahead of the cancel request reaching the server at all.
      const successHash = buildPayuResponseHash(
        { key: fields.key, txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, status: "success" },
        paymentConfig.payuSalt as string
      );
      await request(app)
        .post(WEBHOOK_URL)
        .type("form")
        .send({ status: "success", txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, mihpayid: `mihpay_${fields.txnid}`, mode: "UPI", hash: successHash });

      const cancelRes = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerToken}`).send({});
      expect([409, 422]).toContain(cancelRes.status);

      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("consumed");
    });
  });

  // -------------------------------------------------------------------
  // Refunds
  // -------------------------------------------------------------------
  describe("Refunds use persisted paid-order and line-discount amounts", () => {
    async function placeDeliverAndReturn(
      coupon: Coupon,
      overrides: { quantity?: number; returnQuantity?: number; price?: string } = {}
    ): Promise<{ orderId: number; orderItemId: number; returnId: number }> {
      const quantity = overrides.quantity ?? 4;
      const product = await createSimpleProduct({ price: overrides.price ?? "500.00", stock: 20 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity });
      await request(app).post(`${CART_URL}/coupon`).set("Authorization", `Bearer ${customerToken}`).send({ code: coupon.code });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());
      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
      const orderId = orderRes.body.data.id;

      const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields = initRes.body.data.fields;
      const hash = buildPayuResponseHash(
        { key: fields.key, txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, status: "success" },
        paymentConfig.payuSalt as string
      );
      await request(app)
        .post(WEBHOOK_URL)
        .type("form")
        .send({ status: "success", txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, mihpayid: `mihpay_${fields.txnid}`, mode: "UPI", hash });

      for (const status of ["processing", "shipped", "delivered"]) {
        await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status });
      }

      const orderItem = await OrderItem.findOne({ where: { order_id: orderId } });
      const created = await request(app)
        .post(RETURNS_URL)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ orderId, orderItemId: orderItem!.id, quantity: overrides.returnQuantity ?? quantity, reason: "Defective" });
      const returnId = created.body.data.id;
      await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/receive`).set("Authorization", `Bearer ${adminToken}`).send({});
      await request(app).patch(`${ADMIN_RETURNS_URL}/${returnId}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" });

      return { orderId, orderItemId: orderItem!.id, returnId };
    }

    it("a partial return's refund amount subtracts its prorated share of the line's persisted discount, not the full unit price", async () => {
      // Fixed ₹100 off a single-product Order of 4 units @ ₹500 = ₹2000
      // subtotal -> discount_allocated_paise on the one OrderItem is 10000
      // paise (₹100), entirely on this one line. Returning 2 of the 4 units
      // should refund: (2 * 500) - floor(10000 * 2 / 4) = 1000 - 50 = ₹950.00,
      // never the naive 2 * 500 = ₹1000.00.
      const coupon = await createCoupon({ discount_type: "fixed", discount_value: 10_000 });
      const { returnId } = await placeDeliverAndReturn(coupon, { quantity: 4, returnQuantity: 2 });

      const res = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe("950.00");
    });

    it("a full-line return's refund amount equals the line total minus its entire allocated discount", async () => {
      const coupon = await createCoupon({ discount_type: "fixed", discount_value: 10_000 });
      const { returnId } = await placeDeliverAndReturn(coupon, { quantity: 4, returnQuantity: 4 });

      const res = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe("1900.00"); // 2000 - 100
    });

    it("never restores coupon usage after a successful payment and subsequent refund", async () => {
      const coupon = await createCoupon({ discount_type: "fixed", discount_value: 10_000 });
      const { returnId, orderId } = await placeDeliverAndReturn(coupon, { quantity: 2, returnQuantity: 2 });

      await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});

      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("consumed"); // still consumed — a refund never reverts this

      const order = await Order.findByPk(orderId);
      expect(order!.coupon_id).toBe(coupon.id); // immutable snapshot untouched
    });

    it("a full-order cancellation refund refunds exactly the captured (already-discounted) Payment amount", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: 1, request_id: "req_coupon_cancel_1" })));
      const coupon = await createCoupon({ discount_type: "fixed", discount_value: 10_000 });
      const { orderId, total } = await placeOrderWithCoupon(coupon, { quantity: 1, price: "500.00" });
      expect(total).toBe("400.00");

      const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields = initRes.body.data.fields;
      const hash = buildPayuResponseHash(
        { key: fields.key, txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, status: "success" },
        paymentConfig.payuSalt as string
      );
      await request(app)
        .post(WEBHOOK_URL)
        .type("form")
        .send({ status: "success", txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, mihpayid: `mihpay_${fields.txnid}`, mode: "UPI", hash });

      const cancelRes = await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${superAdminToken}`).send({ status: "cancelled" });
      expect(cancelRes.status).toBe(200);

      const refund = await Refund.findOne({ where: { order_id: orderId } });
      expect(refund!.amount).toBe("400.00"); // exactly Payment.amount — already net of the coupon discount

      // A full-order cancellation refund is never coupon-aware itself; the
      // redemption stays exactly as consumeCouponReservation left it (V1
      // rule: a refund never automatically restores usage).
      const redemption = await CouponRedemption.findOne({ where: { coupon_id: coupon.id, order_id: orderId } });
      expect(redemption!.status).toBe("consumed");
    });
  });

  // -------------------------------------------------------------------
  // No-coupon regression
  // -------------------------------------------------------------------
  describe("No-coupon payment regression", () => {
    it("PayU payment for a coupon-free Order behaves exactly as before (no reservation, no redemption row)", async () => {
      const product = await createSimpleProduct({ price: "500.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());
      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
      const orderId = orderRes.body.data.id;
      expect(orderRes.body.data.total).toBe("500.00");

      const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
      const fields = initRes.body.data.fields;
      expect(fields.amount).toBe("500.00");
      const hash = buildPayuResponseHash(
        { key: fields.key, txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, status: "success" },
        paymentConfig.payuSalt as string
      );
      await request(app)
        .post(WEBHOOK_URL)
        .type("form")
        .send({ status: "success", txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, mihpayid: `mihpay_${fields.txnid}`, mode: "UPI", hash });

      const order = await Order.findByPk(orderId);
      expect(order!.status).toBe("confirmed");
      expect(order!.payment_status).toBe("paid");
      expect(order!.coupon_id).toBeNull();
      expect(await CouponRedemption.count({ where: { order_id: orderId } })).toBe(0);
    });
  });
});
