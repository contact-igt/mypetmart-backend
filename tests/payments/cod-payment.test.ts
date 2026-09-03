/* eslint-disable */
import crypto from "node:crypto";
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
import { ProductContentBlock } from "../../src/database/tables/ProductContentBlockTable/index.js";
import { ProductFaq } from "../../src/database/tables/ProductFaqTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductReview } from "../../src/database/tables/ProductReviewTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { Cart } from "../../src/database/tables/CartTable/index.js";
import { CartItem } from "../../src/database/tables/CartItemTable/index.js";
import { Address } from "../../src/database/tables/AddressTable/index.js";
import { Order } from "../../src/database/tables/OrderTable/index.js";
import { OrderItem } from "../../src/database/tables/OrderItemTable/index.js";
import { Payment } from "../../src/database/tables/PaymentTable/index.js";
import { Shipment } from "../../src/database/tables/ShipmentTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { IThinkClient } from "../../src/models/ShipmentModels/ithink.client.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS_URL = "/api/v1/storefront/orders";
const ADMIN_ORDERS_URL = "/api/v1/admin/orders";
const ADMIN_SHIPMENTS_URL = "/api/v1/admin/shipments";
const INITIATE_URL = "/api/v1/storefront/payments/initiate";
const COD_URL = "/api/v1/storefront/payments/cod";

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      {
        id,
        name: "COD Test Category",
        slug: `cod-test-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: "Category for COD tests",
        pet_type: "all",
        active: true,
        display_order: 1
      },
      { transaction: t }
    );
  });
  return category.id;
}

async function createSimpleProduct(overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id,
        category_id: categoryId,
        name: `COD Test Product ${skuCounter}`,
        slug: `cod-test-simple-${skuCounter}-${Date.now()}`,
        sku: `COD-SIMPLE-${skuCounter}-${Date.now()}`,
        description: "Simple product for COD tests",
        pet_type: "all",
        status: "active",
        price: "499.00",
        compare_at_price: null,
        stock: 10,
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
    name: `COD Test Customer ${id}`,
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

async function mintAdminToken(id: number, email: string, role: "admin" | "super_admin" = "admin"): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const admin = await User.create({
    id,
    name: `COD Test Admin ${id}`,
    email,
    password_hash: pwdHash,
    role,
    status: "active",
    reference_code: `ADM-${id}`
  });
  const { session } = await SessionService.createSession(admin.id, "admin", null, null);
  return TokenService.generateAccessToken({
    sub: String(admin.id),
    sessionId: String(session.id),
    role,
    sessionType: "admin"
  });
}

async function createCustomerOrder(token: string, overrides: Partial<Record<string, unknown>> = {}): Promise<{ orderId: number; total: string }> {
  const product = await createSimpleProduct({ stock: 10, ...overrides });
  await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${token}`).send({ productId: product.id, quantity: 1 });
  const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${token}`).send(validAddressPayload());
  const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${token}`).send({ savedAddressId: address.body.data.id });
  return { orderId: res.body.data.id, total: res.body.data.total };
}

async function createGuestOrder(): Promise<{ orderId: number; token: string; total: string }> {
  const product = await createSimpleProduct({ stock: 10 });
  const guest = request.agent(app);
  await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
  const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest-cod@example.com" });
  return { orderId: res.body.data.id, token: res.body.data.guestAccessToken, total: res.body.data.total };
}

describe("Cash on Delivery (COD)", () => {
  let customerAToken: string;
  let customerBToken: string;
  let adminToken: string;
  let superAdminToken: string;
  const CUSTOMER_A_ID = 99801;
  const CUSTOMER_B_ID = 99802;
  const ADMIN_ID = 99803;
  const SUPER_ADMIN_ID = 99804;

  beforeAll(async () => {
    await connectDatabase();

    for (const id of [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID, SUPER_ADMIN_ID]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }

    customerAToken = await mintCustomerToken(CUSTOMER_A_ID, "cod-test-customer-a@example.com");
    customerBToken = await mintCustomerToken(CUSTOMER_B_ID, "cod-test-customer-b@example.com");
    adminToken = await mintAdminToken(ADMIN_ID, "cod-test-admin@example.com");
    // super_admin — used only for the shipment eligibility check below. A
    // pre-existing, unrelated routing quirk (adminRefundRouter is mounted at
    // the broad "/admin" prefix, before adminShipmentRouter's more specific
    // "/admin/shipments" mount — see routes/v1/index.ts) means its
    // authorize("super_admin") middleware intercepts every /admin/shipments
    // request before it ever reaches admin-shipment.routes.ts's own
    // authenticate("admin") gate, regardless of route match. Out of scope
    // for this Phase 1 COD change — not touched here, just worked around.
    superAdminToken = await mintAdminToken(SUPER_ADMIN_ID, "cod-test-super-admin@example.com", "super_admin");
  });

  afterAll(async () => {
    await Shipment.destroy({ where: {}, truncate: false, force: true });
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await User.destroy({ where: { id: [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Shipment.destroy({ where: {}, truncate: false, force: true });
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    categoryId = await createCategory();
    vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["test-courier"]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------
  // COD order creation
  // ---------------------------------------------------------------------
  describe("COD confirmation", () => {
    it("creates a pending Payment with provider/method 'cod' and confirms the Order", async () => {
      const { orderId, total } = await createCustomerOrder(customerAToken);
      const res = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      expect(res.status).toBe(200);
      expect(res.body.data.provider).toBe("cod");
      expect(res.body.data.orderStatus).toBe("confirmed");
      expect(res.body.data.paymentStatus).toBe("pending");
      expect(res.body.data.amount).toBe(total);

      const payment = await Payment.findOne({ where: { order_id: orderId } });
      expect(payment).not.toBeNull();
      expect(payment?.provider).toBe("cod");
      expect(payment?.method).toBe("cod");
      expect(payment?.status).toBe("pending");
      expect(payment?.paid_at).toBeNull();

      const order = await Order.findByPk(orderId);
      expect(order?.status).toBe("confirmed");
      // Critical Phase 1 rule: COD must never be auto-marked "paid".
      expect(order?.payment_status).toBe("pending");
    });

    it("allows an Admin to move a valid COD Order into fulfilment", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      const res = await request(app)
        .patch(`/api/v1/admin/orders/${orderId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "processing" });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("processing");
    });

    it("decrements stock exactly once on COD confirmation", async () => {
      const product = await createSimpleProduct({ stock: 5 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 2 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const order = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId: order.body.data.id });

      const refreshed = await Product.findByPk(product.id);
      expect(refreshed?.stock).toBe(3);
    });

    it("lets a guest confirm COD using their guest recovery token", async () => {
      const { orderId, token } = await createGuestOrder();
      const res = await request(app).post(COD_URL).send({ guestAccessToken: token });

      expect(res.status).toBe(200);
      expect(res.body.data.orderId).toBe(orderId);
      expect(res.body.data.orderStatus).toBe("confirmed");
    });

    it("is idempotent on a repeated/double-click COD confirmation", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const first = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      const second = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.paymentId).toBe(first.body.data.paymentId);

      const payments = await Payment.findAll({ where: { order_id: orderId } });
      expect(payments).toHaveLength(1);
    });

    it("rejects insufficient stock without creating a Payment or confirming the Order", async () => {
      const product = await createSimpleProduct({ stock: 1 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const order = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      // Stock sells out after Order creation but before COD confirmation.
      await Product.update({ stock: 0 }, { where: { id: product.id } });

      const res = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId: order.body.data.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PAYMENT_ORDER_NOT_PAYABLE");

      const payment = await Payment.findOne({ where: { order_id: order.body.data.id } });
      expect(payment).toBeNull();
      const refreshedOrder = await Order.findByPk(order.body.data.id);
      expect(refreshedOrder?.status).toBe("pending");
    });

    it("rejects COD for an unserviceable persisted Order address before opening the stock transaction", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const check = vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue([]);

      const res = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("CHECKOUT_COD_UNAVAILABLE");
      expect(check).toHaveBeenCalledWith("400001", "cod");
      expect(await Payment.count({ where: { order_id: orderId } })).toBe(0);
      expect((await Order.findByPk(orderId))?.status).toBe("pending");
    });
  });

  // ---------------------------------------------------------------------
  // Security: no client-controllable payment/order status
  // ---------------------------------------------------------------------
  describe("Security", () => {
    it("blocks a customer from confirming COD for another customer's Order (non-enumerating 404)", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const res = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerBToken}`).send({ orderId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    });

    it("ignores any client-supplied payment/order status fields and derives amount from the Order snapshot", async () => {
      const { orderId, total } = await createCustomerOrder(customerAToken);
      const res = await request(app)
        .post(COD_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ orderId, paymentStatus: "paid", status: "confirmed", amount: "1.00" } as never);

      expect(res.status).toBe(200);
      expect(res.body.data.amount).toBe(total);
      expect(res.body.data.paymentStatus).toBe("pending");

      const order = await Order.findByPk(orderId);
      expect(order?.payment_status).toBe("pending");
    });

    it("blocks COD confirmation once the Order is already paid", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      await Order.update({ payment_status: "paid" }, { where: { id: orderId } });

      const res = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ORDER_ALREADY_PAID");
    });

    it("blocks COD confirmation while a PayU attempt is still active for the Order", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      const res = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PAYMENT_ATTEMPT_ALREADY_ACTIVE");
    });

    it("rejects a request with neither orderId nor guestAccessToken", async () => {
      const res = await request(app).post(COD_URL).send({});
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // PayU regression: PayU checkout is unaffected by COD's existence
  // ---------------------------------------------------------------------
  describe("PayU regression", () => {
    it("still initiates a normal PayU Hosted Checkout attempt after COD was added", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(200);
      expect(res.body.data.provider).toBe("payu");

      const payment = await Payment.findOne({ where: { order_id: orderId } });
      expect(payment?.provider).toBe("payu");
      expect(payment?.status).toBe("pending");
    });

    it("blocks PayU initiation once the Order was already confirmed via COD", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PAYMENT_ORDER_NOT_PAYABLE");

      // And PayU initiation never created a second Payment row alongside the COD one.
      const payments = await Payment.findAll({ where: { order_id: orderId } });
      expect(payments).toHaveLength(1);
      expect(payments[0]?.provider).toBe("cod");
    });
  });

  // ---------------------------------------------------------------------
  // Shipment compatibility
  //
  // Note: this environment's iThink credentials point at the LIVE
  // production iThink Logistics API (see backend/.env) — ShipmentService.create
  // calls the real courier-serviceability/rate/AWB-creation endpoints
  // immediately once an Order is found eligible (shipment.service.ts's
  // `create()`), with no test/sandbox switch. Deliberately not exercising the
  // "COD order IS eligible" path through the real HTTP endpoint here, to
  // avoid creating a real shipment/AWB against a live account from a test
  // run. The negative case below only reaches the eligibility check inside
  // the DB transaction and returns before any external call is made, so it
  // is safe to test directly against the real router.
  // ---------------------------------------------------------------------
  describe("Shipment eligibility", () => {
    it("still blocks shipment creation for a pending (not yet paid/COD-confirmed) Order — fails before any external provider call", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);

      const res = await request(app)
        .post(`${ADMIN_SHIPMENTS_URL}/orders/${orderId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SHIPMENT_NOT_ELIGIBLE");
    });
  });
});
