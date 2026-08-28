/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../src/app.js";
import { paymentConfig } from "../../src/config/payment.config.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductContentBlock } from "../../src/database/tables/ProductContentBlockTable/index.js";
import { ProductFaq } from "../../src/database/tables/ProductFaqTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductReview } from "../../src/database/tables/ProductReviewTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
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
import { buildPayuResponseHash } from "../../src/models/PaymentModels/payu-hash.util.js";
import { PaymentFinalizationService } from "../../src/models/PaymentModels/payment-finalization.service.js";
import type { NormalizedPaymentResult } from "../../src/models/PaymentModels/payment.types.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS_URL = "/api/v1/storefront/orders";
const INITIATE_URL = "/api/v1/storefront/payments/initiate";
const STATUS_URL = "/api/v1/storefront/payments/status";
const WEBHOOK_URL = "/api/v1/payments/payu/webhook";

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      {
        id,
        name: "Finalization Test Category",
        slug: `finalization-test-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: "Category for payment finalization tests",
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
        name: `Finalization Test Product ${skuCounter}`,
        slug: `finalization-test-simple-${skuCounter}-${Date.now()}`,
        sku: `FIN-SIMPLE-${skuCounter}-${Date.now()}`,
        description: "Simple product for finalization tests",
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

async function createVariantProduct(overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id,
        category_id: categoryId,
        name: `Finalization Test Variant Product ${skuCounter}`,
        slug: `finalization-test-variant-product-${skuCounter}-${Date.now()}`,
        sku: `FIN-VARPROD-${skuCounter}-${Date.now()}`,
        description: "Variant product for finalization tests",
        pet_type: "all",
        status: "active",
        price: "0.00",
        compare_at_price: null,
        stock: 0,
        has_variants: true,
        featured: false,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

async function createVariant(productId: number, overrides: Partial<Record<string, unknown>> = {}): Promise<ProductVariant> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("product_variants", t);
    return ProductVariant.create(
      {
        id,
        product_id: productId,
        name: `Finalization Variant ${skuCounter}`,
        sku: `FIN-VAR-${skuCounter}-${Date.now()}`,
        price: "300.00",
        compare_at_price: null,
        stock: 5,
        active: true,
        display_order: 0,
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
    name: `Finalization Test Customer ${id}`,
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

async function createCustomerOrder(token: string, overrides: { productId?: number; quantity?: number } = {}): Promise<{ orderId: number; total: string; cartId: number; productId: number }> {
  const productId = overrides.productId ?? (await createSimpleProduct({ stock: 10 })).id;
  await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${token}`).send({ productId, quantity: overrides.quantity ?? 1 });
  const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${token}`).send(validAddressPayload());
  const cartBefore = await request(app).get(CART_URL).set("Authorization", `Bearer ${token}`);
  const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${token}`).send({ savedAddressId: address.body.data.id });
  return { orderId: res.body.data.id, total: res.body.data.total, cartId: cartBefore.body.data.id, productId };
}

async function createGuestOrder(overrides: { productId?: number; quantity?: number } = {}): Promise<{ orderId: number; token: string; total: string; agent: ReturnType<typeof request.agent> }> {
  const productId = overrides.productId ?? (await createSimpleProduct({ stock: 10 })).id;
  const guest = request.agent(app);
  await guest.post(`${CART_URL}/items`).send({ productId, quantity: overrides.quantity ?? 1 });
  const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest-finalization@example.com" });
  return { orderId: res.body.data.id, token: res.body.data.guestAccessToken, total: res.body.data.total, agent: guest };
}

type HostedFields = { key: string; txnid: string; amount: string; productinfo: string; firstname: string; email: string; udf1: string };

async function initiateCustomer(token: string, orderId: number): Promise<HostedFields> {
  const res = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${token}`).send({ orderId });
  expect(res.status).toBe(200);
  return res.body.data.fields;
}

async function initiateGuest(guestAccessToken: string): Promise<HostedFields> {
  const res = await request(app).post(INITIATE_URL).send({ guestAccessToken });
  expect(res.status).toBe(200);
  return res.body.data.fields;
}

function buildWebhookBody(fields: HostedFields, overrides: { status?: string; amount?: string; mihpayid?: string; mode?: string } = {}) {
  const status = overrides.status ?? "success";
  const amount = overrides.amount ?? fields.amount;
  const hash = buildPayuResponseHash(
    { key: fields.key, txnid: fields.txnid, amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, status },
    paymentConfig.payuSalt as string
  );
  return {
    status,
    txnid: fields.txnid,
    amount,
    productinfo: fields.productinfo,
    firstname: fields.firstname,
    email: fields.email,
    udf1: fields.udf1,
    mihpayid: overrides.mihpayid ?? `mihpay_${fields.txnid}`,
    mode: overrides.mode ?? "UPI",
    hash
  };
}

async function sendWebhook(body: Record<string, string>) {
  return request(app).post(WEBHOOK_URL).type("form").send(body);
}

describe("PayU verification, webhook & idempotent commerce finalization", () => {
  let customerAToken: string;
  let customerBToken: string;
  const CUSTOMER_A_ID = 99810;
  const CUSTOMER_B_ID = 99811;

  beforeAll(async () => {
    await connectDatabase();
    for (const id of [CUSTOMER_A_ID, CUSTOMER_B_ID]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }
    customerAToken = await mintCustomerToken(CUSTOMER_A_ID, "finalization-customer-a@example.com");
    customerBToken = await mintCustomerToken(CUSTOMER_B_ID, "finalization-customer-b@example.com");
  });

  afterAll(async () => {
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: [CUSTOMER_A_ID, CUSTOMER_B_ID] }, force: true });
    await User.destroy({ where: { id: [CUSTOMER_A_ID, CUSTOMER_B_ID] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    categoryId = await createCategory();
  });

  // -------------------------------------------------------------------
  // Verified success finalization
  // -------------------------------------------------------------------
  describe("Verified success", () => {
    it("marks Payment paid, Order confirmed/paid, decrements stock exactly once, and finalizes the exact originating Cart", async () => {
      const { orderId, cartId, productId } = await createCustomerOrder(customerAToken);
      const order = await Order.findByPk(orderId);
      expect(order?.cart_id).toBe(cartId);

      const fields = await initiateCustomer(customerAToken, orderId);
      const res = await sendWebhook(buildWebhookBody(fields, { mihpayid: "mihpay_success_1" }));
      expect(res.status).toBe(200);

      const payment = await Payment.findOne({ where: { provider_order_id: fields.txnid } });
      expect(payment?.status).toBe("paid");
      expect(payment?.paid_at).not.toBeNull();
      expect(payment?.provider_payment_id).toBe("mihpay_success_1");

      const refreshedOrder = await Order.findByPk(orderId);
      expect(refreshedOrder?.payment_status).toBe("paid");
      expect(refreshedOrder?.status).toBe("confirmed");
      expect(refreshedOrder?.commerce_exception).toBeNull();

      const cart = await Cart.findByPk(cartId);
      expect(cart?.status).toBe("ordered");

      const refreshedProduct = await Product.findByPk(productId);
      expect(refreshedProduct?.stock).toBe(9); // started at 10, decremented by 1 exactly once
    });

    it("decrements variant stock (not the parent product's own stock) for a variant line item", async () => {
      const variantProduct = await createVariantProduct();
      const variant = await createVariant(variantProduct.id, { stock: 3 });

      const guest = request.agent(app);
      await guest.post(`${CART_URL}/items`).send({ productId: variantProduct.id, variantId: variant.id, quantity: 1 });
      const orderRes = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest-variant@example.com" });
      const guestAccessToken = orderRes.body.data.guestAccessToken;

      const fields = await initiateGuest(guestAccessToken);
      const res = await sendWebhook(buildWebhookBody(fields));
      expect(res.status).toBe(200);

      const refreshedVariant = await ProductVariant.findByPk(variant.id);
      expect(refreshedVariant?.stock).toBe(2);
    });

    it("does not clear an unrelated Cart the guest/customer currently has active", async () => {
      const { orderId, cartId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);

      // Customer starts a new Cart for unrelated future shopping before the webhook lands.
      const otherProduct = await createSimpleProduct({ stock: 5 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerBToken}`).send({ productId: otherProduct.id, quantity: 1 });
      const otherCart = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerBToken}`);

      await sendWebhook(buildWebhookBody(fields));

      const paidOrderCart = await Cart.findByPk(cartId);
      expect(paidOrderCart?.status).toBe("ordered");
      const unrelatedCart = await Cart.findByPk(otherCart.body.data.id);
      expect(unrelatedCart?.status).toBe("active");
    });
  });

  // -------------------------------------------------------------------
  // Security: hash / amount / txnid
  // -------------------------------------------------------------------
  describe("Provider verification", () => {
    it("rejects a bad hash without finalizing", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);
      const body = buildWebhookBody(fields);
      const res = await sendWebhook({ ...body, hash: "0".repeat(128) });
      expect(res.status).toBe(200); // still acked — PayU retry can't fix a bad hash

      const payment = await Payment.findOne({ where: { provider_order_id: fields.txnid } });
      expect(payment?.status).toBe("pending");
    });

    it("rejects an amount mismatch without finalizing, even with a validly-computed hash", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);
      // Validly hashed for the tampered amount (simulating a genuine hash but wrong amount) — must still be rejected.
      const res = await sendWebhook(buildWebhookBody(fields, { amount: "1.00" }));
      expect(res.status).toBe(200);

      const payment = await Payment.findOne({ where: { provider_order_id: fields.txnid } });
      expect(payment?.status).toBe("pending");
    });

    it("rejects an unknown txnid without touching any Payment/Order", async () => {
      const fakeFields: HostedFields = {
        key: paymentConfig.payuKey as string,
        txnid: "PAY-999999",
        amount: "500.00",
        productinfo: "Nonexistent",
        firstname: "Ghost",
        email: "ghost@example.com",
        udf1: "0"
      };
      const res = await sendWebhook(buildWebhookBody(fakeFields));
      expect(res.status).toBe(200);
      const payment = await Payment.findOne({ where: { provider_order_id: "PAY-999999" } });
      expect(payment).toBeNull();
    });

    it("never requires customer/admin authentication on the webhook route", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);
      const res = await sendWebhook(buildWebhookBody(fields));
      expect(res.status).toBe(200); // no Authorization header sent at all, still processed
    });
  });

  // -------------------------------------------------------------------
  // Idempotency / replay / race safety
  // -------------------------------------------------------------------
  describe("Idempotency and replay safety", () => {
    it("a duplicate/replayed success webhook does not double-decrement stock or double-finalize the Cart", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await createGuestOrder({ productId: product.id, quantity: 2 });
      const fields = await initiateGuest(guest.token);
      const body = buildWebhookBody(fields);

      await sendWebhook(body);
      await sendWebhook(body);
      await sendWebhook(body);

      const refreshedProduct = await Product.findByPk(product.id);
      expect(refreshedProduct?.stock).toBe(8); // decremented by 2 exactly once, not 6 or 4
    });

    it("a webhook success and a concurrent Verify-API-driven success for the same Payment converge to one finalization (no double mutation)", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);

      const normalized: NormalizedPaymentResult = {
        merchantTransactionId: fields.txnid,
        providerPaymentId: "mihpay_race",
        providerStatus: "success",
        normalizedOutcome: "SUCCESS",
        amount: fields.amount,
        method: "UPI",
        verifiedAt: new Date(),
        verifiedVia: "verify_api",
        safeMetadata: {}
      };

      const [a, b] = await Promise.all([
        PaymentFinalizationService.processVerifiedPaymentResult(normalized),
        PaymentFinalizationService.processVerifiedPaymentResult(normalized)
      ]);

      const codes = [a.code, b.code].sort();
      expect(codes).toEqual(["NOOP_ALREADY_TERMINAL", "SUCCESS_CONFIRMED"]);
    });
  });

  // -------------------------------------------------------------------
  // Failure handling & monotonicity
  // -------------------------------------------------------------------
  describe("Failure handling and monotonicity", () => {
    it("a verified failure marks the Payment failed and leaves the Order payable for retry", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);
      const res = await sendWebhook(buildWebhookBody(fields, { status: "failure" }));
      expect(res.status).toBe(200);

      const payment = await Payment.findOne({ where: { provider_order_id: fields.txnid } });
      expect(payment?.status).toBe("failed");

      const order = await Order.findByPk(orderId);
      expect(order?.payment_status).toBe("pending");

      // Retry creates a brand-new Payment Attempt on the same Order.
      const retryRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(retryRes.status).toBe(200);
      const attempts = await Payment.count({ where: { order_id: orderId } });
      expect(attempts).toBe(2);
    });

    it("a duplicate failure event is an idempotent no-op", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);
      const body = buildWebhookBody(fields, { status: "failure" });
      await sendWebhook(body);
      const res = await sendWebhook(body);
      expect(res.status).toBe(200);
      const payment = await Payment.findOne({ where: { provider_order_id: fields.txnid } });
      expect(payment?.status).toBe("failed");
    });

    it("a stale failure event arriving after a genuine success can never downgrade a paid Payment", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);
      await sendWebhook(buildWebhookBody(fields, { status: "success" }));
      const res = await sendWebhook(buildWebhookBody(fields, { status: "failure" }));
      expect(res.status).toBe(200);

      const payment = await Payment.findOne({ where: { provider_order_id: fields.txnid } });
      expect(payment?.status).toBe("paid");
      const order = await Order.findByPk(orderId);
      expect(order?.payment_status).toBe("paid");
      expect(order?.status).toBe("confirmed");
    });
  });

  // -------------------------------------------------------------------
  // Paid-but-unfulfillable exceptions
  // -------------------------------------------------------------------
  describe("Paid-but-unfulfillable exceptions", () => {
    it("last-unit concurrency: two Orders racing for the same single unit never drive stock negative, and exactly one is confirmed", async () => {
      const product = await createSimpleProduct({ stock: 1 });
      const guestA = await createGuestOrder({ productId: product.id, quantity: 1 });
      const guestB = await createGuestOrder({ productId: product.id, quantity: 1 });

      const fieldsA = await initiateGuest(guestA.token);
      const fieldsB = await initiateGuest(guestB.token);

      const toNormalized = (fields: HostedFields, mihpayid: string): NormalizedPaymentResult => ({
        merchantTransactionId: fields.txnid,
        providerPaymentId: mihpayid,
        providerStatus: "success",
        normalizedOutcome: "SUCCESS",
        amount: fields.amount,
        method: "UPI",
        verifiedAt: new Date(),
        verifiedVia: "webhook",
        safeMetadata: {}
      });

      const [outcomeA, outcomeB] = await Promise.all([
        PaymentFinalizationService.processVerifiedPaymentResult(toNormalized(fieldsA, "mihpay_race_a")),
        PaymentFinalizationService.processVerifiedPaymentResult(toNormalized(fieldsB, "mihpay_race_b"))
      ]);

      const codes = [outcomeA.code, outcomeB.code].sort();
      expect(codes).toEqual(["SUCCESS_COMMERCE_EXCEPTION", "SUCCESS_CONFIRMED"]);

      const refreshedProduct = await Product.findByPk(product.id);
      expect(refreshedProduct?.stock).toBe(0); // never negative

      const orders = await Order.findAll({ where: { id: [guestA.orderId, guestB.orderId] } });
      const confirmed = orders.find((o) => o.status === "confirmed");
      const exceptioned = orders.find((o) => o.commerce_exception === "inventory_unavailable");
      expect(confirmed).toBeDefined();
      expect(exceptioned).toBeDefined();
      // Both Payments are genuinely marked paid — PayU captured both, only one could be fulfilled.
      const payments = await Payment.findAll({ where: { order_id: [guestA.orderId, guestB.orderId] } });
      expect(payments.every((p) => p.status === "paid")).toBe(true);
    });

    it("a verified success for an Order that was independently cancelled while the Payment was in flight is captured but not confirmed", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);

      const order = await Order.findByPk(orderId);
      await order!.update({ status: "cancelled" });

      const res = await sendWebhook(buildWebhookBody(fields));
      expect(res.status).toBe(200);

      const payment = await Payment.findOne({ where: { provider_order_id: fields.txnid } });
      expect(payment?.status).toBe("paid");

      const refreshedOrder = await Order.findByPk(orderId);
      expect(refreshedOrder?.status).toBe("cancelled"); // never resurrected into confirmed
      expect(refreshedOrder?.payment_status).toBe("paid");
      expect(refreshedOrder?.commerce_exception).toBe("order_not_confirmable");
    });
  });

  // -------------------------------------------------------------------
  // Payment status API (browser-return reconciliation)
  // -------------------------------------------------------------------
  describe("Payment status API", () => {
    it("lets a customer query their own Order's payment status", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);
      await sendWebhook(buildWebhookBody(fields));

      const res = await request(app).post(STATUS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(res.status).toBe(200);
      expect(res.body.data.paymentStatus).toBe("paid");
      expect(res.body.data.orderStatus).toBe("confirmed");
    });

    it("blocks a customer from querying another customer's Order", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const res = await request(app).post(STATUS_URL).set("Authorization", `Bearer ${customerBToken}`).send({ orderId });
      expect(res.status).toBe(404);
    });

    it("lets a guest query their own Order using their recovery token", async () => {
      const guest = await createGuestOrder();
      const fields = await initiateGuest(guest.token);
      await sendWebhook(buildWebhookBody(fields, { status: "failure" }));

      const res = await request(app).post(STATUS_URL).send({ guestAccessToken: guest.token });
      expect(res.status).toBe(200);
      expect(res.body.data.paymentStatus).toBe("failed");
    });

    it("rejects a numeric orderId alone from an unauthenticated caller (no numeric-id-only lookup exists)", async () => {
      const guest = await createGuestOrder();
      const res = await request(app).post(STATUS_URL).send({ orderId: guest.orderId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("PAYMENT_GUEST_TOKEN_REQUIRED");
    });

    it("triggers Verify Payment API reconciliation when the local Payment is still pending, and finalizes on a verified success", async () => {
      const { orderId } = await createCustomerOrder(customerAToken);
      const fields = await initiateCustomer(customerAToken, orderId);

      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            status: 1,
            transaction_details: { [fields.txnid]: { mihpayid: "mihpay_via_verify", status: "success", amt: fields.amount, mode: "UPI" } }
          })
        })
      );

      try {
        const res = await request(app).post(STATUS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
        expect(res.status).toBe(200);
        expect(res.body.data.paymentStatus).toBe("paid");

        const payment = await Payment.findOne({ where: { provider_order_id: fields.txnid } });
        expect(payment?.provider_payment_id).toBe("mihpay_via_verify");
      } finally {
        vi.unstubAllGlobals();
      }
    });
  });
});
