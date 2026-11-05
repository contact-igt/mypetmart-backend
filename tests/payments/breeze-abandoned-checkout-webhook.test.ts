import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../src/app.js";
import type * as Database from "../../src/database/index.js";
import type * as Tables from "../../src/database/tables/index.js";
import { logger } from "../../src/utils/logger.js";

const URL = "/api/v1/payments/breeze/abandoned-checkout-webhook";
const API_KEY = "test_breeze_abandoned_checkout_api_key_do_not_use_in_prod";
const SESSION_ID = crypto.randomBytes(16).toString("hex");
const CART_ID = 988050;

describe("Breeze abandoned-checkout webhook", () => {
  let db: typeof Database;
  let T: typeof Tables;

  beforeAll(async () => {
    db = await import("../../src/database/index.js");
    await db.connectDatabase();
    T = await import("../../src/database/tables/index.js");
  });

  beforeEach(async () => {
    await T.BreezeCheckoutSession.destroy({ where: { public_id: SESSION_ID } });
    await T.Cart.destroy({ where: { id: CART_ID }, force: true });
    await T.Cart.create({ id: CART_ID, status: "active", guest_token_hash: "a".repeat(64) });
    await T.BreezeCheckoutSession.create({
      id: 988050,
      public_id: SESSION_ID,
      user_id: null,
      guest_identity_hash: "a".repeat(64),
      cart_id: CART_ID,
      cart_hash: "h".repeat(64),
      amount_paise: 50000,
      cart_snapshot: {},
      order_intent: {},
      breeze_checkout_id: null,
      order_id: null,
      breeze_cart_id: null,
      breeze_order_id: null,
      breeze_txn_id: null,
      payment_id: null,
      last_event_id: null,
      last_error_code: null,
      expires_at: new Date(Date.now() + 3600_000)
    });
  });

  afterAll(async () => {
    await T.BreezeCheckoutSession.destroy({ where: { public_id: SESSION_ID } });
    await T.Cart.destroy({ where: { id: CART_ID }, force: true });
    await db.disconnectDatabase();
  });

  it("releases the matching unresolved checkout from Breeze's abandonment event", async () => {
    const info = vi.spyOn(logger, "info");
    const response = await request(app)
      .post(URL)
      .set("X-Api-Key", API_KEY)
      .send({ cartDetails: { orderId: SESSION_ID }, customer: {}, checkoutUrl: "https://example.test/cart" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "RECEIVED" });
    const session = await T.BreezeCheckoutSession.findOne({ where: { public_id: SESSION_ID } });
    expect(session?.processing_status).toBe("released");
    expect(session?.status).toBe("expired");
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ sessionPublicId: SESSION_ID, sessionFound: true, released: true, delayMs: expect.any(Number) }),
      "breeze abandoned-checkout webhook: authenticated event received"
    );
    info.mockRestore();
  });

  it("does not release a checkout that has already moved beyond awaiting the webhook", async () => {
    await T.BreezeCheckoutSession.update({ processing_status: "order_created" }, { where: { public_id: SESSION_ID } });

    const response = await request(app)
      .post(URL)
      .set("X-Api-Key", API_KEY)
      .send({ cartDetails: { orderId: SESSION_ID } });

    expect(response.status).toBe(200);
    const session = await T.BreezeCheckoutSession.findOne({ where: { public_id: SESSION_ID } });
    expect(session).toMatchObject({ processing_status: "order_created", status: "created" });
  });

  it("rejects a missing or invalid API key", async () => {
    const validBody = { cartDetails: {}, customer: {}, checkoutUrl: "https://example.test/cart" };
    expect((await request(app).post(URL).send(validBody)).status).toBe(401);
    expect((await request(app).post(URL).set("X-Api-Key", "wrong").send(validBody)).status).toBe(401);
  });

  it("rejects a malformed authenticated payload", async () => {
    expect((await request(app).post(URL).set("X-Api-Key", API_KEY).send({})).status).toBe(422);
  });
});
