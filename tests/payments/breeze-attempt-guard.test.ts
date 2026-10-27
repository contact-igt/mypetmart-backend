/* eslint-disable */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Direct tests of the checkout-attempt guard state table and identity scoping.
// Sessions are inserted straight into the table so each processing state is
// exercised exactly, independent of the HTTP flow.

const GUEST_A = "a".repeat(64);
const GUEST_B = "b".repeat(64);
let nextId = 990000;

describe("Breeze checkout attempt guard", () => {
  let db: typeof import("../../src/database/index.js");
  let T: typeof import("../../src/database/tables/index.js");
  let guard: typeof import("../../src/models/PaymentModels/breeze-attempt-guard.js");

  beforeAll(async () => {
    db = await import("../../src/database/index.js");
    await db.connectDatabase();
    T = await import("../../src/database/tables/index.js");
    guard = await import("../../src/models/PaymentModels/breeze-attempt-guard.js");
    for (const id of [990777, 990778]) {
      await T.User.destroy({ where: { id }, force: true });
      await T.User.create({ id, name: "Guard Test", email: `guard-${id}@example.com`, password_hash: "x", role: "customer", status: "active", reference_code: `CUS-${id}` } as never);
    }
  }, 60_000);

  afterAll(async () => {
    await T.BreezeCheckoutSession.destroy({ where: {} });
    await T.Cart.destroy({ where: {}, force: true });
    await T.User.destroy({ where: { id: [990777, 990778] }, force: true });
    await db.disconnectDatabase();
  });

  beforeEach(async () => {
    await T.BreezeCheckoutSession.destroy({ where: {} });
  });

  async function session(opts: { processing: string; userId?: number | null; guestHash?: string | null; cartId?: number }) {
    const id = ++nextId;
    const cartId = opts.cartId ?? 990000 + (id % 900);
    // Carts are referenced by FK; create on demand.
    if (!(await T.Cart.findByPk(cartId))) {
      await T.Cart.create({ id: cartId, status: "ordered", guest_token_hash: crypto.randomBytes(32).toString("hex") } as never);
    }
    return T.BreezeCheckoutSession.create({
      id,
      public_id: crypto.randomBytes(16).toString("hex"),
      user_id: opts.userId ?? null,
      guest_identity_hash: opts.guestHash ?? null,
      cart_id: cartId,
      cart_hash: "c".repeat(64),
      amount_paise: 1000,
      cart_snapshot: {},
      order_intent: null,
      breeze_checkout_id: null,
      order_id: null,
      breeze_cart_id: null,
      breeze_order_id: null,
      breeze_txn_id: null,
      payment_id: null,
      last_event_id: null,
      last_error_code: null,
      processing_status: opts.processing,
      status: "created",
      expires_at: new Date(Date.now() - 3600_000) // deliberately EXPIRED: expiry is not failure
    } as never);
  }

  const guest = (tokenHash: string) => ({ type: "guest" as const, tokenHash });
  const customer = (userId: number) => ({ type: "customer" as const, userId });

  it("an expired-but-unresolved launch (awaiting_webhook) blocks a new attempt: expiry is not failure", async () => {
    await session({ processing: "awaiting_webhook", guestHash: GUEST_A });
    expect(await guard.findBlockingAttempt(guest(GUEST_A))).toBe("BREEZE_ATTEMPT_IN_PROGRESS");
  });

  it("an order exists but its payment is not finalized: BREEZE_PAYMENT_VERIFYING", async () => {
    await session({ processing: "order_created", guestHash: GUEST_A });
    expect(await guard.findBlockingAttempt(guest(GUEST_A))).toBe("BREEZE_PAYMENT_VERIFYING");
  });

  it("reconciliation required blocks with the most severe reason", async () => {
    await session({ processing: "awaiting_webhook", guestHash: GUEST_A });
    await session({ processing: "reconciliation_required", guestHash: GUEST_A });
    expect(await guard.findBlockingAttempt(guest(GUEST_A))).toBe("BREEZE_RECONCILIATION_REQUIRED");
  });

  it("finalized (paid), failed and released attempts do NOT block a legitimate new purchase", async () => {
    await session({ processing: "finalized", guestHash: GUEST_A });
    await session({ processing: "failed", guestHash: GUEST_A });
    await session({ processing: "released", guestHash: GUEST_A });
    expect(await guard.findBlockingAttempt(guest(GUEST_A))).toBeNull();
  });

  it("a guest's unresolved attempt does not block a different guest", async () => {
    await session({ processing: "awaiting_webhook", guestHash: GUEST_A });
    expect(await guard.findBlockingAttempt(guest(GUEST_B))).toBeNull();
  });

  it("identity is checked across carts: an unresolved attempt on an old cart blocks the new cart", async () => {
    await session({ processing: "awaiting_webhook", userId: 990777, cartId: 990100 });
    // Same customer, different (new) cart: still blocked.
    expect(await guard.findBlockingAttempt(customer(990777))).toBe("BREEZE_ATTEMPT_IN_PROGRESS");
  });

  it("a logged-in customer's unresolved attempt does not block another customer", async () => {
    await session({ processing: "awaiting_webhook", userId: 990777 });
    expect(await guard.findBlockingAttempt(customer(990778))).toBeNull();
  });

  it("assertNoBlockingAttempt raises a 409 with the machine-readable reason", async () => {
    await session({ processing: "order_created", guestHash: GUEST_A });
    let caught: any = null;
    try {
      await guard.assertNoBlockingAttempt(guest(GUEST_A));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(guard.BreezeAttemptBlockedError);
    expect(caught.statusCode).toBe(409);
    expect(caught.code).toBe("BREEZE_PAYMENT_VERIFYING");
    expect(caught.details).toMatchObject({ reason: "BREEZE_PAYMENT_VERIFYING", retryable: true });
  });
});
