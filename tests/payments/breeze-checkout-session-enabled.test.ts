/* eslint-disable */
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const CART_URL = "/api/v1/storefront/cart";
const SESSION_URL = "/api/v1/storefront/payments/breeze/checkout-session";

// Throwaway key generated per run — never a real Breeze/merchant key.
const { privateKey, publicKey } = crypto.generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" }
});

let app: typeof import("../../src/app.js").app;
let db: typeof import("../../src/database/index.js");
let tables: typeof import("../../src/database/tables/index.js");
let ids: typeof import("../../src/database/sequences/id-sequence.service.js").IdSequenceService;
let categoryId: number;
let counter = 0;

async function createProduct(overrides: Record<string, unknown> = {}) {
  counter += 1;
  return db.sequelize.transaction(async (t) => {
    const id = await ids.allocateNextId("products", t);
    return tables.Product.create(
      {
        id,
        category_id: categoryId,
        name: `Breeze 1CCO Product ${counter}`,
        slug: `breeze-1cco-${counter}-${Date.now()}`,
        sku: `B1CCO-${counter}-${Date.now()}`,
        description: "1CCO test product",
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

describe("Breeze checkout-session route — feature flag ON", () => {
  beforeAll(async () => {
    vi.stubEnv("BREEZE_1CCO_ENABLED", "true");
    vi.stubEnv("BREEZE_KEY_ID", "test-key-id");
    vi.stubEnv("BREEZE_AMOUNT_UNIT", "paise");
    vi.stubEnv("BREEZE_CART_PRIVATE_KEY", privateKey.replace(/\n/gu, "\\n"));
    // The per-file setup already loaded the environment config; reset so the stubs apply.
    vi.resetModules();
    db = await import("../../src/database/index.js");
    await db.connectDatabase();
    tables = await import("../../src/database/tables/index.js");
    ids = (await import("../../src/database/sequences/id-sequence.service.js")).IdSequenceService;
    app = (await import("../../src/app.js")).app;
    // Importing the full app graph is slow on a cold module cache.
  }, 60_000);

  afterAll(async () => {
    await tables.BreezeCheckoutSession.destroy({ where: {} });
    await tables.CartItem.destroy({ where: {}, force: true });
    await tables.Cart.destroy({ where: {}, force: true });
    await tables.Product.destroy({ where: {}, force: true });
    await tables.Category.destroy({ where: {}, force: true });
    await db.disconnectDatabase();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await tables.BreezeCheckoutSession.destroy({ where: {} });
    await tables.CartItem.destroy({ where: {}, force: true });
    await tables.Cart.destroy({ where: {}, force: true });
    await tables.Product.destroy({ where: {}, force: true });
    await tables.Category.destroy({ where: {}, force: true });
    categoryId = await db.sequelize.transaction(async (t) => {
      const id = await ids.allocateNextId("categories", t);
      await tables.Category.create(
        { id, name: "B1CCO Cat", slug: `b1cco-cat-${Date.now()}`, description: "c", pet_type: "all", active: true, display_order: 1 } as never,
        { transaction: t }
      );
      return id;
    });
  });

  it("signs a server-built cart, persists a durable session and never leaks the private key", async () => {
    const product = await createProduct({ price: "250.00" });
    const guest = request.agent(app);
    // Browser-supplied totals must be ignored: only product + quantity are accepted by the cart.
    await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 2 });

    const res = await guest.post(SESSION_URL).send({ totalPrice: 1, amount: 1 });
    expect(res.status).toBe(200);
    const data = res.body.data;

    expect(data.amountPaise).toBe(50000);
    expect(data.keyId).toBe("test-key-id");
    expect(data.merchantId).toBe("mypetmart");

    const parsed = JSON.parse(data.cart);
    expect(parsed.totalPrice).toBe(50000);
    expect(parsed.items[0].quantity).toBe(2);
    expect(parsed.id).toBe(data.sessionId);

    const verifier = crypto.createVerify("RSA-SHA256");
    verifier.update(data.cart, "utf8");
    expect(verifier.verify(publicKey, data.signature, "base64")).toBe(true);

    const raw = JSON.stringify(res.body);
    expect(raw).not.toContain("PRIVATE KEY");
    expect(raw).not.toContain("BEGIN");

    const row = await tables.BreezeCheckoutSession.findOne({ where: { public_id: data.sessionId } });
    expect(row?.status).toBe("created");
    expect(row?.amount_paise).toBe(50000);
    expect(row?.cart_hash).toBe(crypto.createHash("sha256").update(data.cart, "utf8").digest("hex"));
    expect(row?.order_id).toBeNull();
    expect(row?.processing_status).toBe("awaiting_webhook");
    const intent = typeof row?.order_intent === "string" ? JSON.parse(row.order_intent) : (row?.order_intent as any);
    expect(intent).toMatchObject({ version: 1, subtotalPaise: 50000, totalPaise: 50000, shippingFeePaise: 0 });
    expect(intent.lines[0]).toMatchObject({ productId: product.id, quantity: 2, unitPricePaise: 25000 });

    // No Order, Payment or stock mutation from session creation.
    expect(await tables.Order.count()).toBe(0);
    expect(await tables.Payment.count()).toBe(0);
    await product.reload();
    expect(product.stock).toBe(20);
  });

  it("refuses a second session while an earlier attempt is unresolved (no silent replacement that could double-charge)", async () => {
    const product = await createProduct();
    const guest = request.agent(app);
    await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
    const first = await guest.post(SESSION_URL).send({});
    expect(first.status).toBe(200);
    const second = await guest.post(SESSION_URL).send({});
    expect(second.status).toBe(409);
    expect(JSON.stringify(second.body)).toContain("BREEZE_ATTEMPT_IN_PROGRESS");
    const a = await tables.BreezeCheckoutSession.findOne({ where: { public_id: first.body.data.sessionId } });
    // The first attempt is untouched: it must still be able to receive its webhook.
    expect(a?.status).toBe("created");
    expect(a?.processing_status).toBe("awaiting_webhook");
    expect(await tables.BreezeCheckoutSession.count()).toBe(1);
  });

  it("rejects an empty cart", async () => {
    const res = await request.agent(app).post(SESSION_URL).send({});
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("BREEZE_CART_EMPTY");
  });

  it("rejects a cart containing a COD-only product (payment-eligibility preserved)", async () => {
    const product = await createProduct({ payment_method_eligibility: "cod" });
    const guest = request.agent(app);
    await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
    const res = await guest.post(SESSION_URL).send({});
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("BREEZE_PAYMENT_METHOD_NOT_ALLOWED");
    expect(await tables.BreezeCheckoutSession.count()).toBe(0);
  });

  it("rejects while a coupon is applied instead of charging a different total", async () => {
    const product = await createProduct();
    const guest = request.agent(app);
    await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
    const couponId = await db.sequelize.transaction(async (t) => {
      const id = await ids.allocateNextId("coupons", t);
      await tables.Coupon.create({ id, code: `B1CCO${id}`, name: "B1CCO coupon", discount_type: "percentage", discount_value: 1000, status: "active" } as never, { transaction: t });
      return id;
    });
    const applied = await guest.post(`${CART_URL}/coupon`).send({ code: `B1CCO${couponId}` });
    expect(applied.status).toBe(200);
    const res = await guest.post(SESSION_URL).send({});
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("BREEZE_COUPON_UNSUPPORTED");
    expect(await tables.BreezeCheckoutSession.count()).toBe(0);
    await tables.Coupon.destroy({ where: { id: couponId }, force: true });
  });

  it("refuses a session while the Pay Online discount applies (signed cart would miss the discount)", async () => {
    const { SettingsService } = await import("../../src/models/SettingsModels/settings.service.js");
    const product = await createProduct({ price: "200.00" });
    const guest = request.agent(app);
    await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
    await SettingsService.updatePayOnlineDiscountSettings({ enabled: true, discountType: "percentage", discountValue: "5" } as never);
    try {
      const res = await guest.post(SESSION_URL).send({});
      expect(res.status).toBe(422);
      expect(JSON.stringify(res.body)).toContain("BREEZE_ONLINE_DISCOUNT_UNSUPPORTED");
      expect(await tables.BreezeCheckoutSession.count()).toBe(0);
    } finally {
      await SettingsService.updatePayOnlineDiscountSettings({ enabled: false, discountType: "percentage", discountValue: "0" } as never);
    }
  });

  it("rejects a sub-₹1 prepaid total", async () => {
    const product = await createProduct({ price: "0.50" });
    const guest = request.agent(app);
    await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
    const res = await guest.post(SESSION_URL).send({});
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("PREPAID_MINIMUM_PAYABLE_NOT_MET");
  });
});
