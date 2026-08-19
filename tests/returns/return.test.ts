/* eslint-disable */
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
import { Refund } from "../../src/database/tables/RefundTable/index.js";
import { Replacement } from "../../src/database/tables/ReplacementTable/index.js";
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

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      { id, name: "Return Test Category", slug: `return-test-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, description: "d", pet_type: "all", active: true, display_order: 1 },
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
        name: `Return Test Product ${skuCounter}`,
        slug: `return-test-simple-${skuCounter}-${Date.now()}`,
        sku: `RET-SIMPLE-${skuCounter}-${Date.now()}`,
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
  const user = await User.create({ id, name: `Return Test User ${id}`, email, password_hash: pwdHash, role, status: "active", reference_code: `USR-${id}` });
  const { session } = await SessionService.createSession(user.id, sessionType, null, null);
  return TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role, sessionType });
}

async function createDeliveredPaidOrder(customerToken: string, adminToken: string, overrides: { quantity?: number; unitPrice?: string } = {}): Promise<{ orderId: number; orderItemId: number; quantity: number }> {
  const product = await createSimpleProduct({ stock: 20, price: overrides.unitPrice ?? "500.00" });
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
    const res = await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status });
    expect(res.status).toBe(200);
  }

  const orderItem = await OrderItem.findOne({ where: { order_id: orderId } });
  return { orderId, orderItemId: orderItem!.id, quantity };
}

describe("Returns", () => {
  let customerAToken: string;
  let customerBToken: string;
  let adminToken: string;
  let superAdminToken: string;
  const CUSTOMER_A_ID = 99820;
  const CUSTOMER_B_ID = 99821;
  const ADMIN_ID = 99822;
  const SUPER_ADMIN_ID = 99823;

  beforeAll(async () => {
    await connectDatabase();
    for (const id of [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID, SUPER_ADMIN_ID]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }
    customerAToken = await mintToken(CUSTOMER_A_ID, "return-customer-a@example.com", "customer");
    customerBToken = await mintToken(CUSTOMER_B_ID, "return-customer-b@example.com", "customer");
    adminToken = await mintToken(ADMIN_ID, "return-admin@example.com", "admin");
    superAdminToken = await mintToken(SUPER_ADMIN_ID, "return-super-admin@example.com", "super_admin");
  });

  afterAll(async () => {
    await Replacement.destroy({ where: {}, truncate: false, force: true });
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
    await AuthSession.destroy({ where: { user_id: [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await User.destroy({ where: { id: [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Replacement.destroy({ where: {}, truncate: false, force: true });
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

  // -------------------------------------------------------------------
  // Eligibility
  // -------------------------------------------------------------------
  describe("Return eligibility", () => {
    it("allows a delivered eligible item to request a return", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const res = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "Wrong size" });
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("requested");
      expect(res.body.data.quantity).toBe(1);
    });

    it("rejects a return for a non-delivered order", async () => {
      const product = await createSimpleProduct({ stock: 5 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      const orderItem = await OrderItem.findOne({ where: { order_id: orderRes.body.data.id } });

      const res = await request(app)
        .post(RETURNS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ orderId: orderRes.body.data.id, orderItemId: orderItem!.id, quantity: 1, reason: "Changed mind" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("RETURN_NOT_ELIGIBLE");
    });

    it("rejects a return request for another customer's order", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const res = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerBToken}`).send({ orderId, orderItemId, quantity: 1, reason: "Not mine" });
      expect(res.status).toBe(404); // ownership + existence are indistinguishable to the caller
    });

    it("rejects a quantity greater than purchased", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken, { quantity: 2 });
      const res = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 3, reason: "Too many" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("RETURN_QUANTITY_EXCEEDS_AVAILABLE");
    });

    it("prevents a second return from exceeding the remaining purchased quantity once one is already open", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken, { quantity: 2 });
      const first = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 2, reason: "All of it" });
      expect(first.status).toBe(201);

      const second = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "One more" });
      expect(second.status).toBe(422);
      expect(second.body.error.code).toBe("RETURN_QUANTITY_EXCEEDS_AVAILABLE");
    });

    it("frees up quantity once a return is rejected", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken, { quantity: 2 });
      const first = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 2, reason: "All of it" });
      await request(app).patch(`${ADMIN_RETURNS_URL}/${first.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "reject", note: "Outside policy" });

      const second = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 2, reason: "Retry" });
      expect(second.status).toBe(201);
    });

    it("does not accept a client-supplied refund amount, payment id, or admin id on the request body", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const res = await request(app)
        .post(RETURNS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ orderId, orderItemId, quantity: 1, reason: "test", refundAmount: "9999.00", paymentId: 1, status: "approved" } as never);
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("requested"); // client-supplied status/amount silently ignored, never trusted
    });

    it("concurrent requests for the same OrderItem cannot together exceed the purchased quantity", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken, { quantity: 2 });
      const [r1, r2] = await Promise.all([
        request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 2, reason: "A" }),
        request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 2, reason: "B" })
      ]);
      const statuses = [r1.status, r2.status].sort();
      expect(statuses).toEqual([201, 422]); // exactly one succeeds, the other is correctly rejected — never both 201

      const totalHeld = await ReturnRequest.sum("quantity", { where: { order_item_id: orderItemId, status: ["requested", "approved", "resolved"] } });
      expect(totalHeld).toBeLessThanOrEqual(2);
    });
  });

  // -------------------------------------------------------------------
  // Admin review + RBAC
  // -------------------------------------------------------------------
  describe("Admin review", () => {
    it("lets Admin view the Returns queue", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "x" });
      const res = await request(app).get(ADMIN_RETURNS_URL).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });

    it("rejects an unauthenticated/customer attempt to approve a return", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "x" });
      const res = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${customerAToken}`).send({ action: "approve" });
      expect(res.status).toBe(401);
    });

    it("approves a valid requested return", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "x" });
      const res = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve", note: "Looks good" });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("approved");
      expect(res.body.data.notes.length).toBe(1);
    });

    it("rejects a valid requested return", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "x" });
      const res = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "reject" });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("rejected");
      expect(res.body.data.resolvedAt).not.toBeNull();
    });

    it("cannot re-approve an already-reviewed return", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "x" });
      await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" });
      const res = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${superAdminToken}`).send({ action: "reject" });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("RETURN_ALREADY_REVIEWED");
    });

    it("blocks refund initiation on a rejected return", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "x" });
      await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "reject" });
      const res = await request(app).post(`/api/v1/admin/returns/${created.body.data.id}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("REFUND_RETURN_NOT_APPROVED");
    });
  });

  describe("Replacement resolution", () => {
    it("creates an item-level replacement request without touching PayU or Payment", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken, { quantity: 2 });
      const itemBefore = (await OrderItem.findByPk(orderItemId))!.toJSON();
      const paymentBefore = (await Payment.findOne({ where: { order_id: orderId } }))!.toJSON();

      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({
        orderId,
        orderItemId,
        quantity: 1,
        reason: "Damaged",
        resolution: "replacement"
      });
      expect(created.status).toBe(201);
      expect(created.body.data.resolution).toBe("replacement");

      const approved = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" });
      expect(approved.status).toBe(200);
      expect(approved.body.data.replacement.status).toBe("processing");
      expect(await Replacement.count({ where: { return_request_id: created.body.data.id } })).toBe(1);
      expect(await Refund.count({ where: { return_request_id: created.body.data.id } })).toBe(0);
      expect((await OrderItem.findByPk(orderItemId))!.toJSON()).toEqual(itemBefore);
      expect((await Payment.findOne({ where: { order_id: orderId } }))!.toJSON()).toEqual(paymentBefore);
    });

    it("decrements replacement stock exactly once and blocks duplicate approval", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const orderItem = (await OrderItem.findByPk(orderItemId))!;
      const product = (await Product.findByPk(orderItem.product_id!))!;
      const stockBefore = product.stock;
      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "Damaged", resolution: "replacement" });

      const first = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" });
      const second = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" });
      expect(first.status).toBe(200);
      expect(second.status).toBe(409);
      expect((await product.reload()).stock).toBe(stockBefore - 1);
      expect(await Replacement.count({ where: { return_request_id: created.body.data.id } })).toBe(1);
    });

    it("records stock_unavailable without decrementing or auto-refunding", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const orderItem = (await OrderItem.findByPk(orderItemId))!;
      const product = (await Product.findByPk(orderItem.product_id!))!;
      product.stock = 0;
      await product.save();
      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "Damaged", resolution: "replacement" });

      const approved = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" });
      expect(approved.status).toBe(200);
      expect(approved.body.data.replacement.status).toBe("stock_unavailable");
      expect((await product.reload()).stock).toBe(0);
      expect(await Refund.count({ where: { return_request_id: created.body.data.id } })).toBe(0);
    });

    it("serializes last-stock approvals so stock never becomes negative", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken, { quantity: 2 });
      const orderItem = (await OrderItem.findByPk(orderItemId))!;
      const product = (await Product.findByPk(orderItem.product_id!))!;
      product.stock = 1;
      await product.save();
      const [a, b] = await Promise.all([
        request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "A", resolution: "replacement" }),
        request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "B", resolution: "replacement" })
      ]);

      const [approvalA, approvalB] = await Promise.all([
        request(app).patch(`${ADMIN_RETURNS_URL}/${a.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" }),
        request(app).patch(`${ADMIN_RETURNS_URL}/${b.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" })
      ]);
      expect([approvalA.status, approvalB.status]).toEqual([200, 200]);
      const replacements = await Replacement.findAll({ where: { return_request_id: [a.body.data.id, b.body.data.id] } });
      expect(replacements.map((row) => row.status).sort()).toEqual(["processing", "stock_unavailable"]);
      expect((await product.reload()).stock).toBe(0);
    });

    it("prevents a replacement quantity from entering the refund path", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "Damaged", resolution: "replacement" });
      await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" });

      const refund = await request(app).post(`/api/v1/admin/returns/${created.body.data.id}/refunds`).set("Authorization", `Bearer ${superAdminToken}`).send({});
      expect(refund.status).toBe(422);
      expect(refund.body.error.code).toBe("REFUND_RESOLUTION_MISMATCH");
      expect(await Refund.count({ where: { return_request_id: created.body.data.id } })).toBe(0);
    });

    it("completes once and keeps repeated status updates idempotent", async () => {
      const { orderId, orderItemId } = await createDeliveredPaidOrder(customerAToken, adminToken);
      const created = await request(app).post(RETURNS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId, orderItemId, quantity: 1, reason: "Damaged", resolution: "replacement" });
      await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/review`).set("Authorization", `Bearer ${adminToken}`).send({ action: "approve" });

      const first = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/replacement`).set("Authorization", `Bearer ${adminToken}`).send({ status: "completed" });
      const second = await request(app).patch(`${ADMIN_RETURNS_URL}/${created.body.data.id}/replacement`).set("Authorization", `Bearer ${adminToken}`).send({ status: "completed" });
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect((await ReturnRequest.findByPk(created.body.data.id))!.status).toBe("resolved");
    });
  });
});
