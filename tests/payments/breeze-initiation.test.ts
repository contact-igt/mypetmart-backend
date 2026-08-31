/* eslint-disable */
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS_URL = "/api/v1/storefront/orders";
const INITIATE_PAYU_URL = "/api/v1/storefront/payments/initiate";
const INITIATE_BREEZE_URL = "/api/v1/storefront/payments/breeze/initiate";
const COD_URL = "/api/v1/storefront/payments/cod";

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      {
        id,
        name: "Breeze Init Test Category",
        slug: `breeze-init-cat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: "Category for Breeze initiation tests",
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
        name: `Breeze Init Product ${skuCounter}`,
        slug: `breeze-init-simple-${skuCounter}-${Date.now()}`,
        sku: `BRZ-INIT-${skuCounter}-${Date.now()}`,
        description: "Simple product for Breeze initiation tests",
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
    name: `Breeze Init Customer ${id}`,
    email,
    password_hash: pwdHash,
    role: "customer",
    status: "active",
    reference_code: `CUS-${id}`
  });
  const { session } = await SessionService.createSession(user.id, "customer", null, null);
  return TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role: "customer", sessionType: "customer" });
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
  const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest-breeze@example.com" });
  return { orderId: res.body.data.id, token: res.body.data.guestAccessToken, total: res.body.data.total };
}

describe("Breeze payment initiation (sendOTP -> verifyOTP -> startPayment)", () => {
  let customerAToken: string;
  let customerBToken: string;
  const CUSTOMER_A_ID = 99811;
  const CUSTOMER_B_ID = 99812;

  beforeAll(async () => {
    await connectDatabase();
    for (const id of [CUSTOMER_A_ID, CUSTOMER_B_ID]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }
    customerAToken = await mintCustomerToken(CUSTOMER_A_ID, "breeze-init-a@example.com");
    customerBToken = await mintCustomerToken(CUSTOMER_B_ID, "breeze-init-b@example.com");
  });

  afterAll(async () => {
    await Payment.destroy({ where: {}, force: true });
    await ProductReview.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await CartItem.destroy({ where: {}, force: true });
    await Cart.destroy({ where: {}, force: true });
    await Address.destroy({ where: {}, force: true });
    await ProductFeature.destroy({ where: {}, force: true });
    await ProductMediaAssignment.destroy({ where: {}, force: true });
    await ProductContentBlock.destroy({ where: {}, force: true });
    await ProductFaq.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: { user_id: [CUSTOMER_A_ID, CUSTOMER_B_ID] }, force: true });
    await User.destroy({ where: { id: [CUSTOMER_A_ID, CUSTOMER_B_ID] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Payment.destroy({ where: {}, force: true });
    await ProductReview.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await CartItem.destroy({ where: {}, force: true });
    await Cart.destroy({ where: {}, force: true });
    await Address.destroy({ where: {}, force: true });
    await ProductFeature.destroy({ where: {}, force: true });
    await ProductMediaAssignment.destroy({ where: {}, force: true });
    await ProductContentBlock.destroy({ where: {}, force: true });
    await ProductFaq.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    categoryId = await createCategory();
  });

  it("lets a customer initiate Breeze payment for their own Order and returns server-authoritative SDK params", async () => {
    const { orderId } = await createCustomerOrder(customerAToken, { price: "737.50" });

    const res = await request(app).post(INITIATE_BREEZE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe("breeze");
    expect(res.body.data.merchantId).toBe("mypetmart");
    expect(res.body.data.environment).toBe("smb-release");
    expect(res.body.data.shopUrl).toBe("https://mypetmart.org");
    expect(res.body.data.orderRef).toMatch(/^BRZ-\d{6,}-[0-9a-f]{10}$/);
    // Amount authority: 737.50 rupees -> 73750 paise, NOT any client value.
    expect(res.body.data.amountPaise).toBe(73750);
    expect(res.body.data.currency).toBe("INR");
    expect(res.body.data.customerPhone).toBe("9876543210");
    expect(res.body.data.orderId).toBe(orderId);
    expect(res.body.data.returnUrl).toContain("/order/payment/result");
    // No secret is ever returned to the browser.
    expect(JSON.stringify(res.body.data)).not.toContain("webhook");
  });

  it("creates exactly one provider:\"breeze\" pending Payment Attempt, amount snapshotted from the Order", async () => {
    const { orderId, total } = await createCustomerOrder(customerAToken);
    await request(app).post(INITIATE_BREEZE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

    const payments = await Payment.findAll({ where: { order_id: orderId } });
    expect(payments).toHaveLength(1);
    expect(payments[0]!.provider).toBe("breeze");
    expect(payments[0]!.status).toBe("pending");
    expect(payments[0]!.amount).toBe(total);
    expect(payments[0]!.provider_order_id).toMatch(/^BRZ-/);
  });

  it("is idempotent — a second initiate reuses the same attempt and orderRef", async () => {
    const { orderId } = await createCustomerOrder(customerAToken);
    const first = await request(app).post(INITIATE_BREEZE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
    const second = await request(app).post(INITIATE_BREEZE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });

    expect(first.body.data.orderRef).toBe(second.body.data.orderRef);
    expect(await Payment.count({ where: { order_id: orderId } })).toBe(1);
  });

  it("ignores a client-supplied amount and uses Payment.amount", async () => {
    const { orderId } = await createCustomerOrder(customerAToken, { price: "499.00" });
    const res = await request(app)
      .post(INITIATE_BREEZE_URL)
      .set("Authorization", `Bearer ${customerAToken}`)
      .send({ orderId, amount: "1.00", amountPaise: 100 } as never);
    expect(res.body.data.amountPaise).toBe(49900);
  });

  it("blocks a customer initiating Breeze payment for another customer's Order (non-enumerating 404)", async () => {
    const { orderId } = await createCustomerOrder(customerAToken);
    const res = await request(app).post(INITIATE_BREEZE_URL).set("Authorization", `Bearer ${customerBToken}`).send({ orderId });
    expect(res.status).toBe(404);
  });

  it("lets a guest initiate Breeze payment with their recovery token, and rejects a bare orderId", async () => {
    const { orderId, token } = await createGuestOrder();

    const ok = await request(app).post(INITIATE_BREEZE_URL).send({ guestAccessToken: token });
    expect(ok.status).toBe(200);
    expect(ok.body.data.orderId).toBe(orderId);

    const bad = await request(app).post(INITIATE_BREEZE_URL).send({ orderId });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("PAYMENT_GUEST_TOKEN_REQUIRED");
  });

  it("blocks switching to Breeze while a PayU attempt is still pending for the Order", async () => {
    const { orderId } = await createCustomerOrder(customerAToken);
    // Seed a pending PayU attempt directly, WITHOUT a provider_order_id, so
    // reconcilePendingAttempt is a no-op (no PayU network call in the test).
    const pid = await sequelize.transaction((t) => IdSequenceService.allocateNextId("payments", t));
    await Payment.create({
      id: pid,
      order_id: orderId,
      amount: "499.00",
      currency: "INR",
      provider: "payu",
      status: "pending",
      provider_order_id: null,
      provider_payment_id: null,
      method: null,
      raw_payload: null
    } as never);

    const res = await request(app).post(INITIATE_BREEZE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PAYMENT_ATTEMPT_ALREADY_ACTIVE");
  });

  it("blocks Breeze payment once the Order has been confirmed for Cash on Delivery", async () => {
    const { orderId } = await createCustomerOrder(customerAToken);
    const cod = await request(app).post(COD_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
    expect(cod.status).toBe(200);

    const res = await request(app).post(INITIATE_BREEZE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PAYMENT_ORDER_NOT_PAYABLE");
  });

  it("does not disturb the existing PayU initiation endpoint", async () => {
    const { orderId } = await createCustomerOrder(customerAToken);
    const res = await request(app).post(INITIATE_PAYU_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
    expect(res.status).toBe(200);
    expect(res.body.data.provider).toBe("payu");
  });
});
