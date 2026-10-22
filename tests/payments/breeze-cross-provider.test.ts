/* eslint-disable */
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Cross-provider duplicate-payment protection, driven over HTTP:
//   - a Breeze checkout unresolved on a cart blocks PayU and COD for that cart,
//   - a pending PayU payment on a cart blocks a new Breeze checkout for that cart,
//   - concurrent starts on the same cart: exactly one succeeds,
//   - releasing the unresolved Breeze attempt (audited) unblocks PayU.
// Breeze 1CCO is enabled only inside this file's environment stub.

const CART = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS = "/api/v1/storefront/orders";
const PAYU_INIT = "/api/v1/storefront/payments/initiate";
const COD = "/api/v1/storefront/payments/cod";
const BREEZE_SESSION = "/api/v1/storefront/payments/breeze/checkout-session";

const CUSTOMER_ID = 990901;
const SUPER_ID = 990902;

const privateKeyPem = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
}).privateKey;

let db: typeof import("../../src/database/index.js");
let T: typeof import("../../src/database/tables/index.js");
let app: typeof import("../../src/app.js").app;
let ids: typeof import("../../src/database/sequences/id-sequence.service.js").IdSequenceService;
let categoryId = 0;
let counter = 0;
let customerToken = "";
let superToken = "";

const validAddress = { recipientName: "Cross Provider", phone: "+91 98765 43210", line1: "221B Baker Street", city: "Mumbai", state: "Maharashtra", postalCode: "400001" };

async function mint(id: number, role: "customer" | "super_admin") {
  const { PasswordService } = await import("../../src/services/auth/password.service.js");
  const { SessionService } = await import("../../src/services/auth/session.service.js");
  const { TokenService } = await import("../../src/services/auth/token.service.js");
  await T.AuthSession.destroy({ where: { user_id: id }, force: true });
  await T.User.destroy({ where: { id }, force: true });
  const user = await T.User.create({ id, name: `XP ${role}`, email: `xp-${id}@example.com`, password_hash: await PasswordService.hash("TestPass123!@#"), role, status: "active", reference_code: `XP-${id}` } as never);
  const sessionType = role === "customer" ? "customer" : "admin";
  const { session } = await SessionService.createSession(user.id, sessionType, null, null);
  return TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role, sessionType });
}

async function product(price = "250.00") {
  counter += 1;
  return db.sequelize.transaction(async (t) => {
    const id = await ids.allocateNextId("products", t);
    return T.Product.create({ id, category_id: categoryId, name: `XP ${counter}`, slug: `xp-${counter}-${Date.now()}`, sku: `XP-${counter}-${Date.now()}`, description: "x", pet_type: "all", status: "active", price, compare_at_price: null, stock: 50, has_variants: false, featured: false } as never, { transaction: t });
  });
}

/** Puts one item in the customer's active cart (a Breeze session needs a non-empty cart). */
async function addItem(): Promise<void> {
  const p = await product();
  const res = await request(app).post(`${CART}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: p.id, quantity: 1 });
  expect(res.status).toBe(201);
}

/** Customer cart with one item, a saved address, and a pending order. Returns the order id. */
async function customerOrder(): Promise<number> {
  const p = await product();
  await request(app).post(`${CART}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: p.id, quantity: 1 });
  const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddress);
  const res = await request(app).post(ORDERS).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
  expect(res.status).toBe(201);
  return res.body.data.id;
}

async function clearState() {
  await T.BreezeAdminActionRecord.destroy({ where: {} });
  await T.BreezeWebhookEvent.destroy({ where: {} });
  await T.BreezeCheckoutSession.destroy({ where: {} });
  await T.Payment.destroy({ where: {}, force: true });
  await T.OrderItem.destroy({ where: {}, force: true });
  await T.Order.destroy({ where: {}, force: true });
  await T.CartItem.destroy({ where: {}, force: true });
  await T.Cart.destroy({ where: {}, force: true });
  await T.Address.destroy({ where: {}, force: true });
  await T.Product.destroy({ where: {}, force: true });
  await T.Category.destroy({ where: {}, force: true });
  categoryId = await db.sequelize.transaction(async (t) => {
    const id = await ids.allocateNextId("categories", t);
    await T.Category.create({ id, name: "XP Cat", slug: `xp-cat-${Date.now()}`, description: "c", pet_type: "all", active: true, display_order: 1 } as never, { transaction: t });
    return id;
  });
}

describe("Cross-provider duplicate-payment protection (Breeze <-> PayU/COD)", () => {
  beforeAll(async () => {
    vi.stubEnv("BREEZE_1CCO_ENABLED", "true");
    vi.stubEnv("BREEZE_KEY_ID", "xp-key");
    vi.stubEnv("BREEZE_AMOUNT_UNIT", "rupees");
    vi.stubEnv("BREEZE_CART_PRIVATE_KEY", privateKeyPem.replace(/\n/gu, "\\n"));
    // The per-file setup already evaluated the environment config (it loads the
    // database layer). Reset the module graph so the Breeze flags come from the stubs.
    vi.resetModules();
    db = await import("../../src/database/index.js");
    await db.connectDatabase();
    T = await import("../../src/database/tables/index.js");
    ids = (await import("../../src/database/sequences/id-sequence.service.js")).IdSequenceService;
    app = (await import("../../src/app.js")).app;
    customerToken = await mint(CUSTOMER_ID, "customer");
    superToken = await mint(SUPER_ID, "super_admin");
  }, 60_000);

  afterAll(async () => {
    await clearState();
    for (const id of [CUSTOMER_ID, SUPER_ID]) {
      await T.AuthSession.destroy({ where: { user_id: id }, force: true });
      await T.User.destroy({ where: { id }, force: true });
    }
    await db.disconnectDatabase();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await clearState();
    // Each test needs a fresh cart: place nothing, just ensure the customer has no leftover active cart items.
  });

  it("an unresolved Breeze checkout blocks PayU for the same cart (409, machine-readable)", async () => {
    await addItem();
    const session = await request(app).post(BREEZE_SESSION).set("Authorization", `Bearer ${customerToken}`).send({});
    expect(session.status).toBe(200);
    const orderId = await customerOrder();
    const payu = await request(app).post(PAYU_INIT).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
    expect(payu.status).toBe(409);
    expect(JSON.stringify(payu.body)).toContain("BREEZE_ATTEMPT_UNRESOLVED_FOR_CART");
    expect(await T.Payment.count({ where: { order_id: orderId } })).toBe(0);
  });

  it("an unresolved Breeze checkout blocks COD confirmation for the same cart (409), and nothing is written", async () => {
    await addItem();
    await request(app).post(BREEZE_SESSION).set("Authorization", `Bearer ${customerToken}`).send({});
    const orderId = await customerOrder();
    const cod = await request(app).post(COD).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
    expect(cod.status).toBe(409);
    expect(JSON.stringify(cod.body)).toContain("BREEZE_ATTEMPT_UNRESOLVED_FOR_CART");
    expect(await T.Payment.count({ where: { order_id: orderId } })).toBe(0);
    expect((await T.Order.findByPk(orderId))?.status).toBe("pending");
  });

  it("an EXPIRED but unresolved Breeze checkout still blocks: expiry is not failure", async () => {
    await addItem();
    await request(app).post(BREEZE_SESSION).set("Authorization", `Bearer ${customerToken}`).send({});
    await db.sequelize.query("UPDATE breeze_checkout_sessions SET expires_at = NOW() - INTERVAL 3 HOUR");
    const orderId = await customerOrder();
    const payu = await request(app).post(PAYU_INIT).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
    expect(payu.status).toBe(409);
    expect((await T.BreezeCheckoutSession.findOne())?.processing_status).toBe("awaiting_webhook");
  });

  it("a pending PayU payment on the cart blocks a new Breeze checkout (409 BREEZE_PAYU_ATTEMPT_PENDING)", async () => {
    // Build the cart and order first, then start PayU (creates a pending payu Payment).
    const p = await product();
    await request(app).post(`${CART}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: p.id, quantity: 1 });
    const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddress);
    const order = await request(app).post(ORDERS).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
    const payu = await request(app).post(PAYU_INIT).set("Authorization", `Bearer ${customerToken}`).send({ orderId: order.body.data.id });
    expect(payu.status).toBe(200);
    expect(await T.Payment.count({ where: { provider: "payu", status: "pending" } })).toBe(1);

    const breeze = await request(app).post(BREEZE_SESSION).set("Authorization", `Bearer ${customerToken}`).send({});
    expect(breeze.status).toBe(409);
    expect(JSON.stringify(breeze.body)).toContain("BREEZE_PAYU_ATTEMPT_PENDING");
    expect(await T.BreezeCheckoutSession.count()).toBe(0);
  });

  it("concurrent starts on the same cart: exactly one of Breeze and PayU succeeds (no double purchase)", async () => {
    const p = await product();
    await request(app).post(`${CART}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: p.id, quantity: 1 });
    const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddress);
    const order = await request(app).post(ORDERS).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
    const orderId = order.body.data.id;

    const [breeze, payu] = await Promise.all([
      request(app).post(BREEZE_SESSION).set("Authorization", `Bearer ${customerToken}`).send({}),
      request(app).post(PAYU_INIT).set("Authorization", `Bearer ${customerToken}`).send({ orderId })
    ]);
    const successes = [breeze.status, payu.status].filter((s) => s === 200).length;
    expect(successes).toBe(1);
    expect(await T.BreezeCheckoutSession.count() + await T.Payment.count({ where: { provider: "payu" } })).toBe(1);
  });

  it("after an audited super-admin release of the unresolved Breeze attempt, PayU for the same cart is allowed again", async () => {
    await addItem();
    await request(app).post(BREEZE_SESSION).set("Authorization", `Bearer ${customerToken}`).send({});
    const orderId = await customerOrder();
    expect((await request(app).post(PAYU_INIT).set("Authorization", `Bearer ${customerToken}`).send({ orderId })).status).toBe(409);

    const session = await T.BreezeCheckoutSession.findOne();
    const release = await request(app)
      .post(`/api/v1/admin/breeze/sessions/${session!.id}/release`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ reason: "Checked Breeze dashboard: no capture", confirmation: "NO_PROVIDER_CAPTURE_CONFIRMED" });
    expect(release.status).toBe(200);

    const payu = await request(app).post(PAYU_INIT).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
    expect(payu.status).toBe(200);
  });
  it("a late captured payment after an audited release is still reconciled: one Order, one paid Payment", async () => {
    await addItem();
    const started = await request(app).post(BREEZE_SESSION).set("Authorization", `Bearer ${customerToken}`).send({});
    expect(started.status).toBe(200);
    const sessionId: string = started.body.data.sessionId;
    const amountRupees = started.body.data.amountPaise / 100;
    const session = await T.BreezeCheckoutSession.findOne({ where: { public_id: sessionId } });
    const release = await request(app)
      .post(`/api/v1/admin/breeze/sessions/${session!.id}/release`)
      .set("Authorization", `Bearer ${superToken}`)
      .send({ reason: "Dashboard showed no capture at the time", confirmation: "NO_PROVIDER_CAPTURE_CONFIRMED" });
    expect(release.status).toBe(200);

    // The capture happened anyway (the release was based on an earlier check). The
    // authenticated webhook must still reconcile it into exactly one Order and Payment.
    const address = { name: "Late Capture", line1: "221B Baker Street", city: "Mumbai", district: "Mumbai", state: "Maharashtra", country: "IN", postalCode: "400001", phoneNumber: "9876543210", countryCode: "+91", type: "Home" };
    const hook = await request(app)
      .post("/api/v1/payments/breeze/order-create-webhook")
      .set("X-Api-Key", "test_breeze_webhook_api_key_do_not_use_in_prod")
      .send({
        id: `evt-late-${Date.now()}`,
        eventName: "ORDER_SUCCEEDED",
        content: {
          orderId: `bz-late-${Date.now()}`,
          txnId: `txn-late-${Date.now()}`,
          status: "SUCCESS",
          offers: [],
          payment: { paymentMethod: "UPI", paymentMethodType: "UPI", amount: amountRupees, currency: "INR" },
          billingAddress: address,
          shippingAddress: address,
          customer: { customerId: "late", phoneNumber: "9876543210", countryCode: "+91" },
          cart: { id: sessionId, breezeCartId: `bzc-late-${Date.now()}`, initialPrice: amountRupees, totalPrice: amountRupees, totalDiscount: 0, itemCount: 1, items: [], currency: "INR" }
        }
      });
    expect(hook.status).toBe(200);
    const orders = await T.Order.findAll({ where: { cart_id: session!.cart_id } });
    expect(orders.length).toBe(1);
    const payments = await T.Payment.findAll({ where: { order_id: orders[0]!.id } });
    expect(payments.length).toBe(1);
    expect(payments[0]!.status).toBe("paid");
    expect((await T.BreezeCheckoutSession.findOne({ where: { public_id: sessionId } }))?.processing_status).toBe("finalized");
  });
});
