/* eslint-disable */
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { buildPayuRequestHash } from "../../src/models/PaymentModels/payu-hash.util.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS_URL = "/api/v1/storefront/orders";
const ADMIN_ORDERS_URL = "/api/v1/admin/orders";
const INITIATE_URL = "/api/v1/storefront/payments/initiate";

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      {
        id,
        name: "Payment Test Category",
        slug: `payment-test-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: "Category for Payment Initiation tests",
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
        name: `Payment Test Product ${skuCounter}`,
        slug: `payment-test-simple-${skuCounter}-${Date.now()}`,
        sku: `PAY-SIMPLE-${skuCounter}-${Date.now()}`,
        description: "Simple product for Payment Initiation tests",
        pet_type: "all",
        status: "active",
        price: "499.00",
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
    name: `Payment Test Customer ${id}`,
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

async function mintAdminToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const admin = await User.create({
    id,
    name: `Payment Test Admin ${id}`,
    email,
    password_hash: pwdHash,
    role: "admin",
    status: "active",
    reference_code: `ADM-${id}`
  });
  const { session } = await SessionService.createSession(admin.id, "admin", null, null);
  return TokenService.generateAccessToken({
    sub: String(admin.id),
    sessionId: String(session.id),
    role: "admin",
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
  const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest-payment@example.com" });
  return { orderId: res.body.data.id, token: res.body.data.guestAccessToken, total: res.body.data.total };
}

describe("Payment Initiation (PayU Hosted Checkout)", () => {
  let customerAToken: string;
  let customerBToken: string;
  let adminToken: string;
  const CUSTOMER_A_ID = 99701;
  const CUSTOMER_B_ID = 99702;
  const ADMIN_ID = 99703;

  beforeAll(async () => {
    await connectDatabase();

    for (const id of [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }

    customerAToken = await mintCustomerToken(CUSTOMER_A_ID, "payment-test-customer-a@example.com");
    customerBToken = await mintCustomerToken(CUSTOMER_B_ID, "payment-test-customer-b@example.com");
    adminToken = await mintAdminToken(ADMIN_ID, "payment-test-admin@example.com");
  });

  afterAll(async () => {
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID] }, force: true });
    await User.destroy({ where: { id: [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    categoryId = await createCategory();
  });

  // ---------------------------------------------------------------------
  // Authorization
  // ---------------------------------------------------------------------
  describe("Authorization", () => {
    it("lets a customer initiate payment for their own Order", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(200);
      expect(res.body.data.provider).toBe("payu");
    });

    it("blocks a customer from initiating payment for another customer's Order (non-enumerating 404)", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerBToken}`).send({ orderId });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    });

    it("lets a guest initiate payment for their own Order using their guest recovery token", async () => {
      const { token } = await createGuestOrder();
      const res = await request(app).post(INITIATE_URL).send({ guestAccessToken: token });
      expect(res.status).toBe(200);
      expect(res.body.data.provider).toBe("payu");
    });

    it("does not let one guest's recovery token initiate payment for a different guest's Order", async () => {
      const orderA = await createGuestOrder();
      const orderB = await createGuestOrder();
      const res = await request(app).post(INITIATE_URL).send({ guestAccessToken: orderA.token });
      expect(res.status).toBe(200);
      expect(res.body.data.fields.udf1).toBe(String(orderA.orderId));
      expect(res.body.data.fields.udf1).not.toBe(String(orderB.orderId));
    });

    it("rejects a numeric orderId alone from an unauthenticated caller — a guest recovery token is required", async () => {
      const { orderId } = await createGuestOrder();
      const res = await request(app).post(INITIATE_URL).send({ orderId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("PAYMENT_GUEST_TOKEN_REQUIRED");
    });

    it("rejects a well-formed but unknown/forged guest token with the same 404 as a real-but-wrong one", async () => {
      const forged = crypto.randomBytes(32).toString("hex");
      const res = await request(app).post(INITIATE_URL).send({ guestAccessToken: forged });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    });

    it("rejects an authenticated customer supplying a guestAccessToken instead of orderId", async () => {
      const { token } = await createGuestOrder();
      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ guestAccessToken: token });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("PAYMENT_CUSTOMER_ORDER_ID_REQUIRED");
    });

    it("rejects a request with neither orderId nor guestAccessToken", async () => {
      const res = await request(app).post(INITIATE_URL).send({});
      expect(res.status).toBe(400);
    });

    it("rejects a request with both orderId and guestAccessToken", async () => {
      const res = await request(app).post(INITIATE_URL).send({ orderId: 1, guestAccessToken: crypto.randomBytes(32).toString("hex") });
      expect(res.status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------
  // Amount / currency authority
  // ---------------------------------------------------------------------
  describe("Amount authority", () => {
    it("uses Payment.amount (snapshotted from Order.total) as the PayU amount — never a client-supplied amount", async () => {
      const { orderId, total } = await createCustomerOrder(customerAToken, { price: "737.50" });
      const res = await request(app)
        .post(INITIATE_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ orderId, amount: "1.00", total: "1.00" } as never);

      expect(res.status).toBe(200);
      expect(res.body.data.fields.amount).toBe(total);

      const payment = await Payment.findOne({ where: { order_id: orderId } });
      expect(payment?.amount).toBe(total);
    });

    it("never accepts a client-supplied surl/furl — always the backend-configured storefront return URLs", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const res = await request(app)
        .post(INITIATE_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ orderId, surl: "https://evil.example.com/steal", furl: "https://evil.example.com/steal" } as never);

      expect(res.status).toBe(200);
      expect(res.body.data.fields.surl).toBe(paymentConfig.successReturnUrl);
      expect(res.body.data.fields.furl).toBe(paymentConfig.failureReturnUrl);
      expect(res.body.data.fields.surl).not.toContain("evil.example.com");
    });
  });

  // ---------------------------------------------------------------------
  // Payment Attempt behavior / idempotency
  // ---------------------------------------------------------------------
  describe("Payment Attempt behavior", () => {
    it("creates exactly one pending Payment Attempt on first initiation", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      const attempts = await Payment.findAll({ where: { order_id: orderId } });
      expect(attempts).toHaveLength(1);
      expect(attempts[0]?.status).toBe("pending");
      expect(attempts[0]?.provider_order_id).toBeTruthy();
    });

    it("keeps the same txnid across repeated initiation calls for the same active attempt", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const first = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      const second = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.fields.txnid).toBe(first.body.data.fields.txnid);

      const attempts = await Payment.findAll({ where: { order_id: orderId } });
      expect(attempts).toHaveLength(1);
    });

    it("double-click / rapid concurrent initiation does not create multiple active Payment Attempts", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);

      const results = await Promise.all(
        Array.from({ length: 5 }, () => request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId }))
      );

      for (const res of results) {
        expect(res.status).toBe(200);
      }
      const txnids = new Set(results.map((r) => r.body.data.fields.txnid));
      expect(txnids.size).toBe(1);

      const attempts = await Payment.findAll({ where: { order_id: orderId } });
      expect(attempts).toHaveLength(1);
    });

    it("allows a new Payment Attempt (new txnid) after the active one failed", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const first = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      await Payment.update({ status: "failed", failed_at: new Date() }, { where: { order_id: orderId } });

      const second = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      expect(second.status).toBe(200);
      expect(second.body.data.fields.txnid).not.toBe(first.body.data.fields.txnid);
      const attempts = await Payment.findAll({ where: { order_id: orderId } });
      expect(attempts).toHaveLength(2);
    });

    it("allows a new Payment Attempt (new txnid) after the active one was cancelled", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const first = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      await Payment.update({ status: "cancelled" }, { where: { order_id: orderId } });

      const second = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      expect(second.status).toBe(200);
      expect(second.body.data.fields.txnid).not.toBe(first.body.data.fields.txnid);
    });

    it("blocks initiation once the Order is already paid", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      await Order.update({ payment_status: "paid" }, { where: { id: orderId } });

      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ORDER_ALREADY_PAID");
    });
  });

  // ---------------------------------------------------------------------
  // PayU request contract
  // ---------------------------------------------------------------------
  describe("PayU Hosted Checkout request", () => {
    it("returns all required Hosted Checkout fields and never the merchant salt", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      expect(res.status).toBe(200);
      const { fields } = res.body.data;
      for (const key of ["key", "txnid", "amount", "productinfo", "firstname", "email", "phone", "surl", "furl", "udf1", "hash"]) {
        expect(fields[key]).toBeTruthy();
      }
      expect(res.body.data.gatewayUrl).toBe(paymentConfig.gatewayUrl);

      const raw = JSON.stringify(res.body);
      expect(raw).not.toContain(paymentConfig.payuSalt as string);
    });

    it("returns a hash matching an independent recomputation with the same fields and configured salt", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      const { fields } = res.body.data;

      const recomputed = buildPayuRequestHash(
        {
          key: fields.key,
          txnid: fields.txnid,
          amount: fields.amount,
          productinfo: fields.productinfo,
          firstname: fields.firstname,
          email: fields.email,
          udf1: fields.udf1
        },
        paymentConfig.payuSalt as string
      );
      expect(fields.hash).toBe(recomputed);
    });

    it("uses Order.contact_email for the PayU email field, never a client-supplied email", async () => {
      const { token } = await createGuestOrder();
      const res = await request(app)
        .post(INITIATE_URL)
        .send({ guestAccessToken: token, email: "attacker@evil.example.com" } as never);

      expect(res.status).toBe(200);
      expect(res.body.data.fields.email).toBe("guest-payment@example.com");
    });

    it("uses Order.ship_recipient_name / ship_phone snapshot for firstname/phone, never client-supplied values", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const res = await request(app)
        .post(INITIATE_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ orderId, firstname: "Attacker", phone: "0000000000" } as never);

      expect(res.status).toBe(200);
      expect(res.body.data.fields.firstname).toBe("Jordan");
      expect(res.body.data.fields.phone).toBe("9876543210");
    });
  });

  // ---------------------------------------------------------------------
  // Eligibility
  // ---------------------------------------------------------------------
  describe("Order eligibility", () => {
    it("blocks initiation for a cancelled Order", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const cancel = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "cancelled" });
      expect(cancel.status).toBe(200);

      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PAYMENT_ORDER_NOT_PAYABLE");
    });

    it("blocks initiation for an Order with no contact email on file", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      await Order.update({ contact_email: null }, { where: { id: orderId } });

      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("PAYMENT_ORDER_NOT_PAYABLE");
    });

    it("returns a not-found (not payable-422) for a nonexistent orderId", async () => {
      const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId: 999999999 });
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Regression: Order/Cart/guest recovery remain unaffected by initiation
  // ---------------------------------------------------------------------
  describe("Regression safety", () => {
    it("does not mutate Order.status, Order.payment_status, or Payment.status on initiation", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      const order = await Order.findByPk(orderId);
      expect(order?.status).toBe("pending");
      expect(order?.payment_status).toBe("pending");

      const payment = await Payment.findOne({ where: { order_id: orderId } });
      expect(payment?.status).toBe("pending");
    });

    it("leaves the Cart untouched after initiation", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const order = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId: order.body.data.id });

      const cart = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(cart.body.data.items.length).toBeGreaterThan(0);
    });

    it("guest Order recovery by token still works after a payment initiation call", async () => {
      const { orderId, token } = await createGuestOrder();
      await request(app).post(INITIATE_URL).send({ guestAccessToken: token });

      const recovered = await request(app).get(`${ORDERS_URL}/guest/${token}`);
      expect(recovered.status).toBe(200);
      expect(recovered.body.data.id).toBe(orderId);
      expect(recovered.body.data.paymentStatus).toBe("pending");
    });

    it("does not leak raw_payload or the salt through the Admin Order detail Payments projection", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

      const detail = await request(app).get(`${ADMIN_ORDERS_URL}/${orderId}`).set("Authorization", `Bearer ${adminToken}`);
      expect(detail.status).toBe(200);
      const raw = JSON.stringify(detail.body);
      expect(raw).not.toContain(paymentConfig.payuSalt as string);
    });
  });
});
