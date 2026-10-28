/* eslint-disable */
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const CART_URL = "/api/v1/storefront/cart";
const SESSION_URL = "/api/v1/storefront/payments/breeze/checkout-session";
const STATUS_URL = "/api/v1/storefront/payments/breeze/checkout-session/status";
const WEBHOOK_URL = "/api/v1/payments/breeze/order-create-webhook";
// vitest.config.ts supplies this deterministic, non-real key.
const API_KEY = "test_breeze_webhook_api_key_do_not_use_in_prod";

const { privateKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

let app: typeof import("../../src/app.js").app;
let db: typeof import("../../src/database/index.js");
let T: typeof import("../../src/database/tables/index.js");
let ids: typeof import("../../src/database/sequences/id-sequence.service.js").IdSequenceService;
let categoryId: number;
let counter = 0;
let eventCounter = 0;

async function createProduct(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return db.sequelize.transaction(async (t) => {
    const id = await ids.allocateNextId("products", t);
    return T.Product.create(
      {
        id,
        category_id: categoryId,
        name: `Bridge Product ${counter}`,
        slug: `bridge-${counter}-${Date.now()}`,
        sku: `BRG-${counter}-${Date.now()}`,
        description: "bridge test product",
        pet_type: "all",
        status: "active",
        price: "250.00",
        compare_at_price: null,
        stock: 20,
        has_variants: false,
        featured: false,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

type Session = { sessionId: string; amountPaise: number };

async function newSession(agent: ReturnType<typeof request.agent>, product: { id: number }, quantity = 2, headers: Record<string, string> = {}): Promise<Session> {
  await agent.post(`${CART_URL}/items`).set(headers).send({ productId: product.id, quantity });
  const res = await agent.post(SESSION_URL).set(headers).send({});
  expect(res.status).toBe(200);
  return { sessionId: res.body.data.sessionId, amountPaise: res.body.data.amountPaise };
}

const ADDRESS = {
  id: "addr-1",
  customerId: "cust-1",
  name: "Jordan Rivera",
  line1: "221B Baker Street",
  city: "Mumbai",
  district: "Mumbai",
  state: "Maharashtra",
  country: "IN",
  postalCode: "400001",
  phoneNumber: "9876543210",
  countryCode: "+91",
  type: "Home"
};

function webhook(session: Session, overrides: { id?: string; eventName?: string; status?: string | null; content?: Record<string, unknown>; amountPaise?: number } = {}) {
  eventCounter += 1;
  const rupees = (overrides.amountPaise ?? session.amountPaise) / 100;
  const content: Record<string, unknown> = {
    orderId: `bz-order-${eventCounter}`,
    txnId: `bz-txn-${eventCounter}`,
    offers: [],
    payment: { paymentMethod: "UPI_DUMMY", paymentMethodType: "UPI", amount: rupees, currency: "INR" },
    billingAddress: ADDRESS,
    shippingAddress: ADDRESS,
    customer: { customerId: "cust-1", phoneNumber: "9876543210", countryCode: "+91", name: "Jordan Rivera", emailAddress: "guest-bridge@example.com" },
    cart: { id: session.sessionId, breezeCartId: `bz-cart-${eventCounter}`, initialPrice: rupees, totalPrice: rupees, totalDiscount: 0, itemCount: 2, items: [{ id: "1", title: "x", quantity: 2 }], currency: "INR" },
    ...(overrides.status === null ? {} : { status: overrides.status ?? "SUCCESS" }),
    ...(overrides.content ?? {})
  };
  return { id: overrides.id ?? `evt-${eventCounter}-${Date.now()}`, eventName: overrides.eventName ?? "ORDER_SUCCEEDED", content };
}

function post(body: unknown, key: string | null = API_KEY) {
  const req = request(app).post(WEBHOOK_URL);
  if (key !== null) req.set("X-Api-Key", key);
  return req.send(body as object);
}

async function clean() {
  await T.BreezeWebhookEvent.destroy({ where: {} });
  await T.BreezeCheckoutSession.destroy({ where: {} });
  await T.Payment.destroy({ where: {}, force: true });
  await T.OrderItem.destroy({ where: {}, force: true });
  await T.Order.destroy({ where: {}, force: true });
  await T.CartItem.destroy({ where: {}, force: true });
  await T.Cart.destroy({ where: {}, force: true });
  await T.Product.destroy({ where: {}, force: true });
  await T.Category.destroy({ where: {}, force: true });
}

describe("Breeze Full 1CCO Order Create Webhook bridge", () => {
  beforeAll(async () => {
    vi.stubEnv("BREEZE_1CCO_ENABLED", "true");
    vi.stubEnv("BREEZE_KEY_ID", "test-key-id");
    vi.stubEnv("BREEZE_AMOUNT_UNIT", "rupees");
    vi.stubEnv("BREEZE_CART_PRIVATE_KEY", privateKey.replace(/\n/gu, "\\n"));
    // The per-file setup already loaded the environment config; reset so the stubs apply.
    vi.resetModules();
    db = await import("../../src/database/index.js");
    await db.connectDatabase();
    T = await import("../../src/database/tables/index.js");
    ids = (await import("../../src/database/sequences/id-sequence.service.js")).IdSequenceService;
    app = (await import("../../src/app.js")).app;
  }, 60_000);

  afterAll(async () => {
    await clean();
    await db.disconnectDatabase();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await clean();
    categoryId = await db.sequelize.transaction(async (t) => {
      const id = await ids.allocateNextId("categories", t);
      await T.Category.create({ id, name: "Bridge Cat", slug: `bridge-cat-${Date.now()}`, description: "c", pet_type: "all", active: true, display_order: 1 } as never, { transaction: t });
      return id;
    });
  });

  // ---------------------------------------------------------------- contract
  describe("authentication and contract validation", () => {
    it("rejects a missing API key and a wrong API key with 401 and creates nothing", async () => {
      const session = { sessionId: "a".repeat(32), amountPaise: 1000 };
      expect((await post(webhook(session), null)).status).toBe(401);
      const wrong = await post(webhook(session), "not-the-key");
      expect(wrong.status).toBe(401);
      expect(JSON.stringify(wrong.body)).not.toContain(API_KEY);
      expect(await T.BreezeWebhookEvent.count()).toBe(0);
      expect(await T.Order.count()).toBe(0);
    });

    it("rejects an invalid / empty body with 422 listing field paths only", async () => {
      const res = await post({});
      expect(res.status).toBe(422);
      expect(res.body.invalidFields).toEqual(expect.arrayContaining(["id", "eventName", "content"]));
    });

    it("requires documented fields and does not accept undocumented aliases (eventData/data)", async () => {
      const session = { sessionId: "b".repeat(32), amountPaise: 1000 };
      const body = webhook(session) as any;
      const aliased = { id: body.id, eventName: body.eventName, eventData: body.content, data: body.content };
      const res = await post(aliased);
      expect(res.status).toBe(422);
      const missing = webhook(session) as any;
      delete missing.content.shippingAddress;
      const res2 = await post(missing);
      expect(res2.status).toBe(422);
      expect(res2.body.invalidFields).toContain("content.shippingAddress");
    });

    it("rejects an amount sent as a string (unsupported representation)", async () => {
      const session = { sessionId: "c".repeat(32), amountPaise: 1000 };
      const body = webhook(session) as any;
      body.content.payment.amount = "10.00";
      const res = await post(body);
      expect(res.status).toBe(422);
      expect(res.body.invalidFields).toContain("content.payment.amount");
    });

    it("optional txnId may be omitted when status is explicit: SUCCESS still finalizes", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product);
      const body = webhook(session, { status: "SUCCESS" }) as any;
      delete body.content.txnId;
      const res = await post(body);
      expect(res.status).toBe(200);
      expect(await T.Order.count()).toBe(1);
      const payment = await T.Payment.findOne();
      expect(payment?.status).toBe("paid");
      // provider_payment_id falls back to Breeze's order id when txnId is absent.
      expect(payment?.provider_payment_id).toBe(body.content.orderId);
    });

    it("an event with NO status is held for reconciliation: no Order, no Payment, not inferred as paid", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product);
      const res = await post(webhook(session, { status: null }));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("PENDING");
      expect(await T.Order.count()).toBe(0);
      expect(await T.Payment.count()).toBe(0);
      expect((await T.BreezeWebhookEvent.findOne())?.outcome_code).toBe("UNKNOWN_STATUS");
    });

    it("ignores an undocumented event name (no Order, 200 ack with PENDING)", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product);
      const res = await post(webhook(session, { eventName: "ORDER_SOMETHING_ELSE" }));
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("PENDING");
      expect(await T.Order.count()).toBe(0);
    });

    it("unknown merchant cart id: 422, no order, evidence recorded", async () => {
      const res = await post(webhook({ sessionId: "d".repeat(32), amountPaise: 1000 }));
      expect(res.status).toBe(422);
      const event = await T.BreezeWebhookEvent.findOne();
      expect(event?.status).toBe("reconciliation_required");
      expect(event?.outcome_code).toBe("UNKNOWN_SESSION");
      expect(await T.Order.count()).toBe(0);
    });
  });

  // ------------------------------------------------------------- happy path
  describe("guest checkout success", () => {
    it("creates exactly one Order+Payment from the IMMUTABLE snapshot and finalizes once", async () => {
      const product = await createProduct({ price: "250.00", stock: 20 });
      const guest = request.agent(app);
      const session = await newSession(guest, product, 2);
      expect(session.amountPaise).toBe(50000);

      // Customer/ops changes the world after Breeze opened: price and cart both change.
      await product.update({ price: "999.00" });
      const other = await createProduct({ price: "10.00" });
      await guest.post(`${CART_URL}/items`).send({ productId: other.id, quantity: 1 });

      const body = webhook(session) as any;
      const res = await post(body);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: body.id, status: "SUCCESS", message: "Order created successfully" });
      const orders = await T.Order.findAll();
      expect(orders).toHaveLength(1);
      const order = orders[0]!;
      expect(res.body.content.orderId).toBe(order.order_number);
      expect(order.status).toBe("confirmed");
      expect(order.payment_status).toBe("paid");
      expect(order.total).toBe("500.00");
      expect(order.user_id).toBeNull();
      expect(order.contact_email).toBe("guest-bridge@example.com");
      expect(order.ship_postal_code).toBe("400001");
      expect(order.ship_country).toBe("IN");

      const items = await T.OrderItem.findAll({ where: { order_id: order.id } });
      expect(items).toHaveLength(1);
      expect(items[0]!.unit_price).toBe("250.00"); // snapshot, not the new 999.00
      expect(items[0]!.quantity).toBe(2);

      const payments = await T.Payment.findAll();
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({ provider: "breeze", status: "paid", amount: "500.00", currency: "INR" });
      expect(payments[0]!.provider_order_id).toBe(`BRZC-${session.sessionId}`);
      expect(payments[0]!.provider_payment_id).toBe(body.content.txnId);

      await product.reload();
      expect(product.stock).toBe(18); // decremented exactly once

      const row = await T.BreezeCheckoutSession.findOne({ where: { public_id: session.sessionId } });
      expect(row).toMatchObject({ processing_status: "finalized", status: "completed", breeze_order_id: body.content.orderId, breeze_txn_id: body.content.txnId, breeze_cart_id: body.content.cart.breezeCartId });
      expect(row?.order_id).toBe(order.id);
      expect(row?.payment_id).toBe(payments[0]!.id);
    });

    it("replay of the SAME event id returns the stored response and mutates nothing", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session);
      const first = await post(body);
      const second = await post(body);
      expect(second.status).toBe(200);
      expect(second.body).toEqual(first.body);
      expect(await T.Order.count()).toBe(1);
      expect(await T.Payment.count()).toBe(1);
      await product.reload();
      expect(product.stock).toBe(18);
      const event = await T.BreezeWebhookEvent.findOne();
      expect(event?.attempts).toBeGreaterThanOrEqual(2);
    });

    it("a DIFFERENT event id for the same checkout reuses the Order (no second Order, no second decrement)", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      const first = await post(webhook(session));
      const row = (await T.BreezeCheckoutSession.findOne({ where: { public_id: session.sessionId } }))!;
      const dup = webhook(session, { content: { orderId: row.breeze_order_id, txnId: row.breeze_txn_id } }) as any;
      const second = await post(dup);
      expect(second.status).toBe(200);
      expect(second.body.content.orderId).toBe(first.body.content.orderId);
      expect(await T.Order.count()).toBe(1);
      expect(await T.Payment.count()).toBe(1);
      await product.reload();
      expect(product.stock).toBe(18);
    });

    it("concurrent deliveries create exactly one Order and decrement stock once", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      const same = webhook(session);
      const results = await Promise.all([post(same), post(same), post(same), post({ ...same, id: `${same.id}-other` })]);
      for (const res of results) expect([200, 500, 409]).toContain(res.status);
      expect(results.some((res) => res.status === 200)).toBe(true);
      expect(await T.Order.count()).toBe(1);
      expect(await T.Payment.count()).toBe(1);
      await product.reload();
      expect(product.stock).toBe(18);
      const paid = await T.Payment.findOne();
      expect(paid?.status).toBe("paid");
    });

    it("insufficient stock after capture: Order still created, commerce exception recorded, still acknowledged", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      await product.update({ stock: 0 });
      const res = await post(webhook(session));
      expect(res.status).toBe(200);
      const order = await T.Order.findOne();
      expect(order).toMatchObject({ payment_status: "paid", status: "pending", commerce_exception: "inventory_unavailable" });
      await product.reload();
      expect(product.stock).toBe(0);
    });

    it("an expired-but-unresolved session still accepts its late captured payment, and blocks a new attempt meanwhile", async () => {
      const product = await createProduct({ stock: 20 });
      const guest = request.agent(app);
      const first = await newSession(guest, product, 1);
      // Expiry is NOT failure: a new attempt is refused until the first resolves.
      const retired = await T.BreezeCheckoutSession.findOne({ where: { public_id: first.sessionId } });
      await retired!.update({ expires_at: new Date(Date.now() - 3600_000) });
      const second = await guest.post(SESSION_URL).send({});
      expect(second.status).toBe(409);
      expect(JSON.stringify(second.body)).toContain("BREEZE_ATTEMPT_IN_PROGRESS");
      const res = await post(webhook(first));
      expect(res.status).toBe(200);
      expect(await T.Order.count()).toBe(1);
      expect((await T.Payment.findOne())?.status).toBe("paid");
    });
  });

  // ---------------------------------------------------------------- customer
  describe("logged-in customer", () => {
    it("binds the Order to the session's customer and uses the account email", async () => {
      const { PasswordService } = await import("../../src/services/auth/password.service.js");
      const { SessionService } = await import("../../src/services/auth/session.service.js");
      const { TokenService } = await import("../../src/services/auth/token.service.js");
      const uid = 99851;
      await T.AuthSession.destroy({ where: { user_id: uid }, force: true });
      await T.User.destroy({ where: { id: uid }, force: true });
      const user = await T.User.create({ id: uid, name: "Bridge Customer", email: "bridge-customer@example.com", password_hash: await PasswordService.hash("TestPass123!@#"), role: "customer", status: "active", reference_code: `CUS-${uid}` } as never);
      const { session: authSession } = await SessionService.createSession(user.id, "customer", null, null);
      const token = TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(authSession.id), role: "customer", sessionType: "customer" });
      const headers = { Authorization: `Bearer ${token}` };

      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 1, headers);
      const res = await post(webhook(session, { content: { customer: { customerId: "x", phoneNumber: "9876543210", countryCode: "+91", emailAddress: "someone-else@example.com" } } }));
      expect(res.status).toBe(200);
      const order = await T.Order.findOne();
      expect(order?.user_id).toBe(uid);
      expect(order?.contact_email).toBe("bridge-customer@example.com");

      // Status lookup: owner only.
      const mine = await request(app).post(STATUS_URL).set(headers).send({ sessionId: session.sessionId });
      expect(mine.status).toBe(200);
      expect(mine.body.data.order.orderNumber).toBe(order!.order_number);
      expect(mine.body.data.guestAccessToken).toBeNull();
      const stranger = await request.agent(app).post(STATUS_URL).send({ sessionId: session.sessionId });
      expect(stranger.status).toBe(404);

      await T.BreezeWebhookEvent.destroy({ where: {} });
      await T.BreezeCheckoutSession.destroy({ where: {} });
      await T.Payment.destroy({ where: {}, force: true });
      await T.OrderItem.destroy({ where: {}, force: true });
      await T.Order.destroy({ where: {}, force: true });
      await T.CartItem.destroy({ where: {}, force: true });
      await T.Cart.destroy({ where: {}, force: true });
      await T.AuthSession.destroy({ where: { user_id: uid }, force: true });
      await T.User.destroy({ where: { id: uid }, force: true });
    });
  });

  // ------------------------------------------------------- financial guards
  describe("financial and data validation (no Order is created)", () => {
    it("amount mismatch is reconciled, never finalized", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product, 2);
      const res = await post(webhook(session, { amountPaise: session.amountPaise - 100 }));
      expect(res.status).toBe(422);
      expect(await T.Order.count()).toBe(0);
      expect(await T.Payment.count()).toBe(0);
      const row = await T.BreezeCheckoutSession.findOne({ where: { public_id: session.sessionId } });
      expect(row?.processing_status).toBe("reconciliation_required");
      expect(row?.last_error_code).toBe("AMOUNT_MISMATCH");
    });

    it("cart total differing from payment amount is rejected", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session) as any;
      body.content.cart.totalPrice = 1;
      expect((await post(body)).status).toBe(422);
      expect(await T.Order.count()).toBe(0);
    });

    it("currency mismatch is rejected", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session) as any;
      body.content.payment.currency = "USD";
      const res = await post(body);
      expect(res.status).toBe(422);
      expect((await T.BreezeCheckoutSession.findOne())?.last_error_code).toBe("CURRENCY_MISMATCH");
    });

    it("confirms a COD/cash outcome without treating it as prepaid paid", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session) as any;
      body.content.payment.paymentMethodType = "COD";
      expect((await post(body)).status).toBe(200);
      const order = await T.Order.findOne();
      const payment = await T.Payment.findOne();
      expect(order).toMatchObject({ status: "confirmed", payment_status: "pending" });
      expect(payment).toMatchObject({ provider: "cod", method: "cod", status: "pending" });
      expect((await T.Product.findByPk(product.id))?.stock).toBe(18);
      expect((await T.BreezeCheckoutSession.findOne())?.processing_status).toBe("finalized");
    });

    it("an invalid shipping address is reconciled without creating an Order; a corrected later event succeeds", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      const bad = webhook(session) as any;
      bad.content.shippingAddress = { ...ADDRESS, postalCode: "12" };
      const res = await post(bad);
      expect(res.status).toBe(422);
      expect(await T.Order.count()).toBe(0);
      expect((await T.BreezeCheckoutSession.findOne())?.last_error_code).toBe("INVALID_SHIPPING_ADDRESS");

      const good = await post(webhook(session));
      expect(good.status).toBe(200);
      expect(await T.Order.count()).toBe(1);
    });

    it("a non-Indian destination is rejected", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session) as any;
      body.content.shippingAddress = { ...ADDRESS, country: "US" };
      expect((await post(body)).status).toBe(422);
      expect(await T.Order.count()).toBe(0);
    });

    it("accepts Breeze's India country label and stores the ISO country code", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session) as any;
      body.content.shippingAddress = { ...ADDRESS, country: "India" };
      const res = await post(body);
      expect(res.status).toBe(200);
      expect((await T.Order.findOne())?.ship_country).toBe("IN");
    });

    it("a second success with DIFFERENT Breeze ids after the Order exists is a possible double payment: reconciled, not merged", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      expect((await post(webhook(session))).status).toBe(200);
      const second = await post(webhook(session)); // fresh orderId/txnId for the same checkout
      expect(second.status).toBe(409);
      expect(await T.Order.count()).toBe(1);
      expect(await T.Payment.count()).toBe(1);
      await product.reload();
      expect(product.stock).toBe(18);
      expect((await T.BreezeCheckoutSession.findOne())?.last_error_code).toBe("PROVIDER_REFERENCE_CONFLICT");
    });

    it("conflicting provider references across sessions are not merged", async () => {
      const product = await createProduct({ stock: 50 });
      const a = await newSession(request.agent(app), product, 1);
      const b = await newSession(request.agent(app), product, 1);
      const first = webhook(a) as any;
      expect((await post(first)).status).toBe(200);
      const second = webhook(b) as any;
      second.content.orderId = first.content.orderId; // same Breeze order id on a competing session
      const res = await post(second);
      expect(res.status).toBe(409);
      expect(await T.Order.count()).toBe(1);
    });
  });

  // ------------------------------------------------------------ status model
  describe("Breeze order statuses", () => {
    it("CREATED / PENDING are recorded and never create an Order or mark paid", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product, 2);
      for (const status of ["CREATED", "PENDING"]) {
        const res = await post(webhook(session, { status }));
        expect(res.status).toBe(200);
        expect(res.body.status).toBe("PENDING");
      }
      expect(await T.Order.count()).toBe(0);
      expect(await T.Payment.count()).toBe(0);
    });

    it("PARTIALLY_PAID is not full payment: reconciliation, no Order", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product, 2);
      const res = await post(webhook(session, { status: "PARTIALLY_PAID" }));
      expect(res.status).toBe(422);
      expect(await T.Order.count()).toBe(0);
      expect((await T.BreezeCheckoutSession.findOne())?.last_error_code).toBe("PARTIAL_PAYMENT_UNSUPPORTED");
    });

    it("PAYMENT_SUCCESS is treated as captured funds (and kept distinct in metadata)", async () => {
      const product = await createProduct();
      const session = await newSession(request.agent(app), product, 2);
      expect((await post(webhook(session, { status: "PAYMENT_SUCCESS" }))).status).toBe(200);
      const payment = await T.Payment.findOne();
      expect(payment?.status).toBe("paid");
      const raw = typeof payment?.raw_payload === "string" ? JSON.parse(payment.raw_payload) : payment?.raw_payload;
      expect((raw as any).breezeStatus).toBe("PAYMENT_SUCCESS");
    });

    it("FAILED with no Order creates nothing; a LATE success afterwards still completes the order", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      const failed = await post(webhook(session, { status: "FAILED" }));
      expect(failed.status).toBe(200);
      expect(await T.Order.count()).toBe(0);
      expect((await T.BreezeCheckoutSession.findOne())?.processing_status).toBe("failed");
      expect((await post(webhook(session))).status).toBe(200);
      expect(await T.Order.count()).toBe(1);
      expect((await T.Payment.findOne())?.status).toBe("paid");
    });

    it("a FAILED/CANCELLED event after a verified success never erases the paid Payment", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      await post(webhook(session));
      const row = (await T.BreezeCheckoutSession.findOne({ where: { public_id: session.sessionId } }))!;
      const stale = await post(webhook(session, { status: "CANCELLED", content: { orderId: row.breeze_order_id, txnId: row.breeze_txn_id } }));
      expect(stale.status).toBe(200);
      const payment = await T.Payment.findOne();
      expect(payment?.status).toBe("paid");
      await product.reload();
      expect(product.stock).toBe(18);
    });

    it("refund statuses are recorded for reconciliation only (no local refund, no PayU path)", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      await post(webhook(session));
      const res = await post(webhook(session, { status: "REFUNDED" }));
      expect(res.status).toBe(200);
      const event = await T.BreezeWebhookEvent.findOne({ where: { outcome_code: "PROVIDER_REFUND_REPORTED" } });
      expect(event?.status).toBe("reconciliation_required");
      expect((await T.Payment.findOne())?.status).toBe("paid");
    });
  });

  // ---------------------------------------------------------------- recovery
  describe("failure recovery (no false acknowledgement, no orphaned payment)", () => {
    it("finalization failing AFTER the Order+Payment commit: 500 now, retry reuses them and finalizes once", async () => {
      const { PaymentFinalizationService } = await import("../../src/models/PaymentModels/payment-finalization.service.js");
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session);

      const spy = vi.spyOn(PaymentFinalizationService, "processVerifiedPaymentResult").mockRejectedValueOnce(new Error("simulated finalization crash"));
      const first = await post(body);
      spy.mockRestore();

      expect(first.status).toBe(500);
      expect(first.body.content).toBeUndefined(); // no order reference claimed
      expect(await T.Order.count()).toBe(1); // stage one is durable
      expect((await T.Payment.findOne())?.status).toBe("pending");
      expect((await T.BreezeWebhookEvent.findOne())?.status).toBe("received");
      expect((await T.BreezeCheckoutSession.findOne())?.processing_status).toBe("order_created");

      const retry = await post(body);
      expect(retry.status).toBe(200);
      expect(await T.Order.count()).toBe(1);
      expect(await T.Payment.count()).toBe(1);
      expect((await T.Payment.findOne())?.status).toBe("paid");
      await product.reload();
      expect(product.stock).toBe(18);
    });

    it("a database failure while creating the Order is not acknowledged and leaves nothing behind; retry succeeds", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session);

      const spy = vi.spyOn(T.Order, "create").mockRejectedValueOnce(new Error("simulated db failure"));
      const first = await post(body);
      spy.mockRestore();

      expect(first.status).toBe(500);
      expect(first.body.status).toBe("FAILED");
      expect(await T.Order.count()).toBe(0);
      expect(await T.Payment.count()).toBe(0);
      expect((await T.BreezeCheckoutSession.findOne())?.order_id).toBeNull();

      const retry = await post(body);
      expect(retry.status).toBe(200);
      expect(await T.Order.count()).toBe(1);
    });

    it("finalization succeeds but the acknowledgement write fails: 500, Breeze retry returns 200 without a second mutation", async () => {
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session);

      // Fail only the save that records the answered (processed) event. Model.create
      // also calls save() internally, so a plain "once" spy would hit claimEvent.
      const originalSave = T.BreezeWebhookEvent.prototype.save;
      const saveSpy = vi.spyOn(T.BreezeWebhookEvent.prototype, "save").mockImplementation(function (this: any, options?: any) {
        if (this.status === "processed") return Promise.reject(new Error("simulated ack-write failure"));
        return originalSave.call(this, options);
      });
      const first = await post(body);
      saveSpy.mockRestore();

      expect(first.status).toBe(500);
      // Money and stock committed on the first attempt...
      expect((await T.Payment.findOne())?.status).toBe("paid");
      await product.reload();
      expect(product.stock).toBe(18);
      // ...and the event was NOT recorded as answered, so the retry is processed.
      expect((await T.BreezeWebhookEvent.findOne())?.status).toBe("received");

      const retry = await post(body);
      expect(retry.status).toBe(200);
      expect(retry.body.content.orderId).toMatch(/^MPM-/);
      expect(await T.Order.count()).toBe(1);
      expect(await T.Payment.count()).toBe(1);
      await product.reload();
      expect(product.stock).toBe(18); // still exactly one decrement
    });

    it("replayStoredEvent re-processes a stored, unfinished event", async () => {
      const { BreezeOrderCreateService } = await import("../../src/models/PaymentModels/breeze-order-create.service.js");
      const { PaymentFinalizationService } = await import("../../src/models/PaymentModels/payment-finalization.service.js");
      const product = await createProduct({ stock: 20 });
      const session = await newSession(request.agent(app), product, 2);
      const body = webhook(session);
      const spy = vi.spyOn(PaymentFinalizationService, "processVerifiedPaymentResult").mockRejectedValueOnce(new Error("boom"));
      await post(body);
      spy.mockRestore();
      const ack = await BreezeOrderCreateService.replayStoredEvent(body.id);
      expect(ack?.httpStatus).toBe(200);
      expect(await T.Order.count()).toBe(1);
      expect((await T.Payment.findOne())?.status).toBe("paid");
    });
  });

  // ------------------------------------------------------------- status API
  describe("browser status lookup", () => {
    it("reports awaiting-webhook, then the confirmed order, only to the owning guest; does not mint or rotate a recovery token", async () => {
      const product = await createProduct({ stock: 20 });
      const guest = request.agent(app);
      const session = await newSession(guest, product, 1);

      const before = await guest.post(STATUS_URL).send({ sessionId: session.sessionId });
      expect(before.status).toBe(200);
      expect(before.body.data).toMatchObject({ awaitingWebhook: true, order: null });

      await post(webhook(session));
      const after = await guest.post(STATUS_URL).send({ sessionId: session.sessionId });
      expect(after.body.data.awaitingWebhook).toBe(false);
      expect(after.body.data.order).toMatchObject({ paymentStatus: "paid", status: "confirmed" });
      // No recovery token is minted by a read (rotation would revoke existing links).
      expect(after.body.data.guestAccessToken).toBeNull();
      const again = await guest.post(STATUS_URL).send({ sessionId: session.sessionId });
      expect(again.body.data.guestAccessToken).toBeNull();

      const other = await request.agent(app).post(STATUS_URL).send({ sessionId: session.sessionId });
      expect(other.status).toBe(404);
      const malformed = await guest.post(STATUS_URL).send({ sessionId: "nope" });
      expect(malformed.status).toBeGreaterThanOrEqual(400);
    });
  });

  // ----------------------------------------------------------- secrets/logs
  it("never echoes the API key or private key material in any response", async () => {
    const product = await createProduct();
    const session = await newSession(request.agent(app), product, 1);
    const res = await post(webhook(session));
    const text = JSON.stringify(res.body);
    expect(text).not.toContain(API_KEY);
    expect(text).not.toMatch(/PRIVATE KEY|BEGIN/u);
  });
});
