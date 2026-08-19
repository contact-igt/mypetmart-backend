/* eslint-disable */
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { ReturnNote } from "../../src/database/tables/ReturnNoteTable/index.js";
import { ReturnRequest } from "../../src/database/tables/ReturnRequestTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { buildPayuResponseHash } from "../../src/models/PaymentModels/payu-hash.util.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS_URL = "/api/v1/storefront/orders";
const ADMIN_ORDERS_URL = "/api/v1/admin/orders";
const INITIATE_URL = "/api/v1/storefront/payments/initiate";
const WEBHOOK_URL = "/api/v1/payments/payu/webhook";
const RETURNS_URL = "/api/v1/storefront/returns";
const ADMIN_RETURNS_URL = "/api/v1/admin/returns";
const REFUND_WEBHOOK_URL = "/api/v1/payments/payu/refund-webhook";

let categoryId: number;
let skuCounter = 0;

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response;
}

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      { id, name: "Refund Test Category", slug: `refund-test-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, description: "d", pet_type: "all", active: true, display_order: 1 },
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
        name: `Refund Test Product ${skuCounter}`,
        slug: `refund-test-simple-${skuCounter}-${Date.now()}`,
        sku: `REF-SIMPLE-${skuCounter}-${Date.now()}`,
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
  const user = await User.create({ id, name: `Refund Test User ${id}`, email, password_hash: pwdHash, role, status: "active", reference_code: `USR-${id}` });
  const { session } = await SessionService.createSession(user.id, sessionType, null, null);
  return TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role, sessionType });
}

async function createApprovedReturn(
  customerToken: string,
  adminToken: string,
  overrides: { quantity?: number; unitPrice?: string; returnQuantity?: number } = {}
): Promise<{ orderId: number; orderItemId: number; returnId: number; productId: number; unitPrice: string }> {
  const unitPrice = overrides.unitPrice ?? "500.00";
  const product = await createSimpleProduct({ stock: 20, price: unitPrice });
  const quantity = overrides.quantity ?? 2;
  await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity });
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
  // Refund initiation now requires the item to be confirmed physically
  // received back first (RETURN_ITEM_NOT_RECEIVED gate) — approval alone is
  // no longer sufficient for a "return" (refund) type request.
  await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/receive`).set("Authorization", `Bearer ${adminToken}`).send({});
  await request(app).patch(`${ADMIN_RETURNS_URL}/${returnId}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" });

  return { orderId, orderItemId: orderItem!.id, returnId, productId: product.id, unitPrice };
}

describe("Refunds", () => {
  let customerAToken: string;
  let adminToken: string;
  let superAdminToken: string;
  const CUSTOMER_A_ID = 99830;
  const ADMIN_ID = 99831;
  const SUPER_ADMIN_ID = 99832;

  beforeAll(async () => {
    await connectDatabase();
    for (const id of [CUSTOMER_A_ID, ADMIN_ID, SUPER_ADMIN_ID]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }
    customerAToken = await mintToken(CUSTOMER_A_ID, "refund-customer-a@example.com", "customer");
    adminToken = await mintToken(ADMIN_ID, "refund-admin@example.com", "admin");
    superAdminToken = await mintToken(SUPER_ADMIN_ID, "refund-super-admin@example.com", "super_admin");
  });

  afterAll(async () => {
    await Refund.destroy({ where: {}, truncate: false, force: true });
    await ReturnNote.destroy({ where: {}, truncate: false, force: true });
    await ReturnRequest.destroy({ where: {}, truncate: false, force: true });
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: [CUSTOMER_A_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await User.destroy({ where: { id: [CUSTOMER_A_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn());
    await Refund.destroy({ where: {}, truncate: false, force: true });
    await ReturnNote.destroy({ where: {}, truncate: false, force: true });
    await ReturnRequest.destroy({ where: {}, truncate: false, force: true });
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

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------
  // Amount authority, idempotency, balance
  // -------------------------------------------------------------------
  describe("Refund amount + idempotency", () => {
    it("derives the refund amount from the OrderItem price snapshot × approved quantity — never client-supplied", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_1", mihpayid: "mihpay1" }));
      const { returnId } = await createApprovedReturn(customerAToken, adminToken, { unitPrice: "500.00", quantity: 2, returnQuantity: 2 });

      const res = await request(app)
        .post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ amount: "1.00", refundAmount: "1.00" } as never); // attacker-supplied amount, must be ignored
      expect(res.status).toBe(201);
      expect(res.body.data.amount).toBe("1000.00"); // 500.00 x 2, not the attacker's 1.00
    });

    it("rejects a refund that would exceed the captured Payment amount", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_1" }));
      // Return quantity capped at what was purchased, but simulate a price
      // increase after purchase to prove the refund still can't exceed the
      // ORIGINAL captured Payment amount, not today's product price.
      const { orderId, returnId } = await createApprovedReturn(customerAToken, adminToken, { unitPrice: "500.00", quantity: 1, returnQuantity: 1 });
      const payment = await Payment.findOne({ where: { order_id: orderId } });
      payment!.amount = "100.00"; // simulate a payment far smaller than the OrderItem's own line total would suggest
      await payment!.save();

      const res = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("REFUND_EXCEEDS_REFUNDABLE_BALANCE");
    });

    it("blocks a second refund initiation while one is already active for the same return", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_1" }));
      const { returnId } = await createApprovedReturn(customerAToken, adminToken);
      const first = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(first.status).toBe(201);

      const second = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("REFUND_ALREADY_INITIATED");

      const count = await Refund.count({ where: { return_request_id: returnId } });
      expect(count).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1); // only one real provider call was ever made
    });

    it("uses the original successful Payment's mihpayid as var1, never a client-supplied id", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_1" }));
      const { orderId, returnId } = await createApprovedReturn(customerAToken, adminToken);
      const payment = await Payment.findOne({ where: { order_id: orderId } });

      await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({ paymentId: 999999 } as never);

      const [, options] = vi.mocked(fetch).mock.calls[0]!;
      const body = new URLSearchParams(options?.body as string);
      expect(body.get("var1")).toBe(payment!.provider_payment_id);
      expect(body.get("var2")!.length).toBeLessThanOrEqual(23); // PayU's 23-char merchant refund token limit
    });

    it("rejects refund initiation when the Order has no paid Payment", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_1" }));
      const { orderId, returnId } = await createApprovedReturn(customerAToken, adminToken);
      const payment = await Payment.findOne({ where: { order_id: orderId } });
      payment!.status = "failed";
      await payment!.save();

      const res = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("REFUND_NO_PAID_PAYMENT_FOUND");
    });
  });

  // -------------------------------------------------------------------
  // RBAC
  // -------------------------------------------------------------------
  describe("Refund RBAC", () => {
    it("rejects refund initiation by a plain admin (super_admin only)", async () => {
      const { returnId } = await createApprovedReturn(customerAToken, adminToken);
      const res = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${adminToken}`).send({});
      expect(res.status).toBe(403);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects refund initiation by a customer", async () => {
      const { returnId } = await createApprovedReturn(customerAToken, adminToken);
      const res = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------
  // Provider acceptance vs. genuine success (finalization)
  // -------------------------------------------------------------------
  describe("Refund finalization", () => {
    it("PayU accepting the request only ever moves the Refund to pending/processing, never immediately succeeded", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_1" }));
      const { returnId } = await createApprovedReturn(customerAToken, adminToken);
      const res = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(["pending", "processing"]).toContain(res.body.data.status);
    });

    it("a genuine SUCCESS from the Status API marks the Refund succeeded and rolls up Payment/Order to fully refunded (single-item order)", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_1" })) // initiate
        .mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_1: { status: "SUCCESS", amt: "500.00", mihpayid: "mihpay1" } } })); // recheck

      const { orderId, returnId } = await createApprovedReturn(customerAToken, adminToken, { unitPrice: "500.00", quantity: 1, returnQuantity: 1 });
      const initiated = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      const refundId = initiated.body.data.id;

      const recheck = await request(app).post(`/api/v1/admin/refunds/${refundId}/recheck`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(recheck.body.data.status).toBe("succeeded");

      const payment = await Payment.findOne({ where: { order_id: orderId } });
      expect(payment!.status).toBe("refunded");
      expect(payment!.amount).toBe("500.00"); // original Payment.amount is never overwritten

      const order = await Order.findByPk(orderId);
      expect(order!.payment_status).toBe("refunded");

      const returnRequest = await ReturnRequest.findByPk(returnId);
      expect(returnRequest!.status).toBe("resolved");
    });

    it("partial refund keeps the Payment 'partially_refunded', not 'refunded'", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_1" }))
        .mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_1: { status: "SUCCESS", amt: "500.00", mihpayid: "mihpay1" } } }));

      // Order total is 2 x 500.00 = 1000.00; only 1 unit is returned/refunded.
      const { orderId, returnId } = await createApprovedReturn(customerAToken, adminToken, { unitPrice: "500.00", quantity: 2, returnQuantity: 1 });
      const initiated = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      await request(app).post(`/api/v1/admin/refunds/${initiated.body.data.id}/recheck`).set("Authorization", `Bearer ${superAdminToken}`).send({});

      const payment = await Payment.findOne({ where: { order_id: orderId } });
      expect(payment!.status).toBe("partially_refunded");
      expect(payment!.amount).toBe("1000.00"); // unchanged original capture

      const order = await Order.findByPk(orderId);
      expect(order!.payment_status).toBe("partially_refunded");
    });

    it("a FAILURE result marks the Refund failed", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_1" }))
        .mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_1: { status: "FAILURE" } } }));

      const { returnId } = await createApprovedReturn(customerAToken, adminToken);
      const initiated = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      const recheck = await request(app).post(`/api/v1/admin/refunds/${initiated.body.data.id}/recheck`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(recheck.body.data.status).toBe("failed");
    });

    it("a stale FAILURE arriving after a genuine SUCCESS can never downgrade it (monotonicity)", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_1" }))
        .mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_1: { status: "SUCCESS", amt: "500.00", mihpayid: "mihpay1" } } }))
        .mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_1: { status: "FAILURE" } } }));

      const { returnId } = await createApprovedReturn(customerAToken, adminToken, { unitPrice: "500.00", quantity: 1, returnQuantity: 1 });
      const initiated = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      await request(app).post(`/api/v1/admin/refunds/${initiated.body.data.id}/recheck`).set("Authorization", `Bearer ${superAdminToken}`).send({}); // -> succeeded
      const stale = await request(app).post(`/api/v1/admin/refunds/${initiated.body.data.id}/recheck`).set("Authorization", `Bearer ${superAdminToken}`).send({}); // stale FAILURE
      expect(stale.body.data.status).toBe("succeeded"); // unchanged
    });

    it("rejects a SUCCESS result whose amount does not match the persisted Refund amount, without finalizing", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_1" }))
        .mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_1: { status: "SUCCESS", amt: "1.00", mihpayid: "mihpay1" } } }));

      const { returnId } = await createApprovedReturn(customerAToken, adminToken, { unitPrice: "500.00", quantity: 1, returnQuantity: 1 });
      const initiated = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      const recheck = await request(app).post(`/api/v1/admin/refunds/${initiated.body.data.id}/recheck`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(recheck.body.data.status).not.toBe("succeeded");
    });

    it("the refund webhook re-verifies via the Status API rather than trusting its own status claim", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_1" })) // initiate
        .mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_1: { status: "FAILURE" } } })); // webhook's own re-verification call

      const { returnId } = await createApprovedReturn(customerAToken, adminToken);
      const initiated = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      const refund = await Refund.findByPk(initiated.body.data.id);

      // Webhook claims SUCCESS — but the mocked Status API re-verification
      // says FAILURE. The webhook's own claim must be ignored.
      const res = await request(app).post(REFUND_WEBHOOK_URL).type("form").send({ token: refund!.provider_refund_token, request_id: "req_1", status: "success" });
      expect(res.status).toBe(200);

      const refreshed = await Refund.findByPk(initiated.body.data.id);
      expect(refreshed!.status).toBe("failed"); // trusts the Status API re-check, not the webhook's own "success" claim
    });

    it("duplicate webhook delivery is idempotent", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_1" }))
        .mockResolvedValue(jsonResponse({ status: 1, transaction_details: { req_1: { status: "SUCCESS", amt: "500.00", mihpayid: "mihpay1" } } }));

      const { returnId } = await createApprovedReturn(customerAToken, adminToken, { unitPrice: "500.00", quantity: 1, returnQuantity: 1 });
      const initiated = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      const refund = await Refund.findByPk(initiated.body.data.id);

      await request(app).post(REFUND_WEBHOOK_URL).type("form").send({ token: refund!.provider_refund_token, request_id: "req_1", status: "success" });
      const second = await request(app).post(REFUND_WEBHOOK_URL).type("form").send({ token: refund!.provider_refund_token, request_id: "req_1", status: "success" });
      expect(second.status).toBe(200);

      const refreshed = await Refund.findByPk(initiated.body.data.id);
      expect(refreshed!.status).toBe("succeeded"); // still exactly succeeded, not double-processed
    });

    it("does not automatically restock inventory on refund success", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_1" }))
        .mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_1: { status: "SUCCESS", amt: "500.00", mihpayid: "mihpay1" } } }));

      const { returnId, productId } = await createApprovedReturn(customerAToken, adminToken, { unitPrice: "500.00", quantity: 1, returnQuantity: 1 });
      const stockBefore = (await Product.findByPk(productId))!.stock;
      const initiated = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      await request(app).post(`/api/v1/admin/refunds/${initiated.body.data.id}/recheck`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      const stockAfter = (await Product.findByPk(productId))!.stock;
      expect(stockAfter).toBe(stockBefore);
    });
  });

  // -------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------
  describe("Refund security", () => {
    it("never exposes the raw PayU payload or merchant salt in any storefront/admin JSON response", async () => {
      vi.mocked(fetch)
        .mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_1" }))
        .mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_1: { status: "SUCCESS", amt: "500.00", mihpayid: "mihpay1" } } }));

      const { orderId, returnId } = await createApprovedReturn(customerAToken, adminToken, { unitPrice: "500.00", quantity: 1, returnQuantity: 1 });
      const initiated = await request(app).post(`${ADMIN_RETURNS_URL}/${returnId}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      await request(app).post(`/api/v1/admin/refunds/${initiated.body.data.id}/recheck`).set("Authorization", `Bearer ${superAdminToken}`).send({});

      const adminDetail = await request(app).get(`${ADMIN_RETURNS_URL}/${returnId}`).set("Authorization", `Bearer ${adminToken}`);
      const serialized = JSON.stringify(adminDetail.body);
      expect(serialized).not.toContain(paymentConfig.payuSalt);
      expect(serialized.toLowerCase()).not.toContain("raw_payload");

      const customerDetail = await request(app).get(`${RETURNS_URL}/${returnId}`).set("Authorization", `Bearer ${customerAToken}`);
      const customerSerialized = JSON.stringify(customerDetail.body);
      expect(customerSerialized).not.toContain(paymentConfig.payuSalt);
      expect(customerSerialized.toLowerCase()).not.toContain("mihpayid");
      expect(customerSerialized.toLowerCase()).not.toContain("provider_refund_token");
    });
  });
});
