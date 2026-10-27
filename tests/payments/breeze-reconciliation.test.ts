/* eslint-disable */
import crypto from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Default test environment: BREEZE_AMOUNT_UNIT is unset, so a stored paid event
// is HELD (received) by the bridge — exactly the state the sweep must retry
// safely without ever turning it into a payment.

const SESSION_ID = 988001;
const CART_ID = 988001;
const PUBLIC_ID = crypto.randomBytes(16).toString("hex");

const ADDRESS = {
  name: "Recon Customer",
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

function payload(eventId: string) {
  return {
    id: eventId,
    eventName: "ORDER_SUCCEEDED",
    content: {
      orderId: `bz-${eventId}`,
      txnId: `txn-${eventId}`,
      status: "SUCCESS",
      offers: [],
      payment: { paymentMethod: "UPI", paymentMethodType: "UPI", amount: 500, currency: "INR" },
      billingAddress: ADDRESS,
      shippingAddress: ADDRESS,
      customer: { customerId: "c-1", phoneNumber: "9876543210", countryCode: "+91", emailAddress: "recon@example.com" },
      cart: { id: PUBLIC_ID, breezeCartId: `bzc-${eventId}`, initialPrice: 500, totalPrice: 500, totalDiscount: 0, itemCount: 1, items: [], currency: "INR" }
    }
  };
}

describe("Breeze reconciliation sweep", () => {
  let db: typeof import("../../src/database/index.js");
  let T: typeof import("../../src/database/tables/index.js");
  let job: typeof import("../../src/models/PaymentModels/breeze-reconciliation.job.js");

  beforeAll(async () => {
    db = await import("../../src/database/index.js");
    await db.connectDatabase();
    T = await import("../../src/database/tables/index.js");
    job = await import("../../src/models/PaymentModels/breeze-reconciliation.job.js");
  });

  beforeEach(async () => {
    await T.BreezeWebhookEvent.destroy({ where: {} });
    await T.BreezeCheckoutSession.destroy({ where: {} });
    await T.Payment.destroy({ where: {}, force: true });
    await T.Order.destroy({ where: {}, force: true });
    await T.Cart.destroy({ where: {}, force: true });
    await T.Cart.create({ id: CART_ID, status: "active", guest_token_hash: "r".repeat(64) } as never);
    await T.BreezeCheckoutSession.create({
      id: SESSION_ID,
      public_id: PUBLIC_ID,
      user_id: null,
      guest_identity_hash: "r".repeat(64),
      cart_id: CART_ID,
      cart_hash: "h".repeat(64),
      amount_paise: 50000,
      cart_snapshot: {},
      order_intent: { version: 1, lines: [], subtotalPaise: 50000, shippingFeePaise: 0, totalPaise: 50000, currency: "INR" },
      breeze_checkout_id: null,
      order_id: null,
      breeze_cart_id: null,
      breeze_order_id: null,
      breeze_txn_id: null,
      payment_id: null,
      last_event_id: null,
      last_error_code: null,
      expires_at: new Date(Date.now() + 3600_000)
    } as never);
  });

  afterAll(async () => {
    await T.BreezeWebhookEvent.destroy({ where: {} });
    await T.BreezeCheckoutSession.destroy({ where: {} });
    await T.Cart.destroy({ where: {}, force: true });
    await db.disconnectDatabase();
  });

  async function storeReceivedEvent(eventId: string, attempts = 1, updatedAgoMs = 20 * 60_000, status: "received" | "reconciliation_required" = "received") {
    const id = await db.sequelize.transaction(async (t) => (await import("../../src/database/sequences/id-sequence.service.js")).IdSequenceService.allocateNextId("breeze_webhook_events", t));
    const row = await T.BreezeWebhookEvent.create({
      id,
      event_id: eventId,
      event_kind: "order_create",
      event_name: "ORDER_SUCCEEDED",
      session_public_id: PUBLIC_ID,
      status,
      payload: payload(eventId),
      attempts
    } as never);
    // Age the row on the DATABASE clock so the test is independent of JS/DB timezone handling.
    await db.sequelize.query("UPDATE breeze_webhook_events SET updated_at = NOW() - INTERVAL ? SECOND WHERE id = ?", { replacements: [Math.round(updatedAgoMs / 1000), row.id] });
    return row.id;
  }

  it("backs off exponentially, never shorter than the claim lease, and caps at 6 hours", () => {
    expect(job.BREEZE_RECONCILE_LEASE_MS).toBe(10 * 60_000);
    expect(job.reconciliationBackoffMs(1)).toBe(10 * 60_000); // lease floor
    expect(job.reconciliationBackoffMs(4)).toBe(10 * 60_000); // 8 min is below the lease
    expect(job.reconciliationBackoffMs(5)).toBe(16 * 60_000); // 16 min
    expect(job.reconciliationBackoffMs(30)).toBe(job.BREEZE_RECONCILE_MAX_BACKOFF_MS);
  });

  it("skips an event that is not yet due (retried too soon)", async () => {
    const id = await storeReceivedEvent("evt-not-due", 1, 0);
    const result = await job.runBreezeReconciliationSweep();
    expect(result.due).toBe(0);
    expect(result.claimed).toBe(0);
    const row = await T.BreezeWebhookEvent.findByPk(id);
    expect(row?.attempts).toBe(1);
  });

  it("a due event is re-attempted and stays held while the amount unit is unconfigured — no Order, no Payment", async () => {
    const id = await storeReceivedEvent("evt-due-held", 1, 10 * 60_000);
    const result = await job.runBreezeReconciliationSweep();
    expect(result.claimed).toBe(1);
    const row = await T.BreezeWebhookEvent.findByPk(id);
    expect(row?.status).toBe("received"); // still retryable, never silently dropped
    expect(row?.attempts).toBe(2); // the attempt was recorded
    expect(row?.outcome_code).toBe("AMOUNT_UNIT_NOT_CONFIGURED");
    expect(await T.Order.count()).toBe(0);
    expect(await T.Payment.count()).toBe(0);
  });

  it("two concurrent sweeps process a due event exactly once (compare-and-set claim)", async () => {
    const id = await storeReceivedEvent("evt-race", 1, 10 * 60_000);
    const [a, b] = await Promise.all([job.runBreezeReconciliationSweep(), job.runBreezeReconciliationSweep()]);
    expect(a.claimed + b.claimed).toBe(1);
    const row = await T.BreezeWebhookEvent.findByPk(id);
    expect(row?.attempts).toBe(2); // one attempt from the single winning claim
  });

  it("retry budget exhausted: moved to reconciliation_required (RETRY_EXHAUSTED), an alert is raised, never retried again", async () => {
    const id = await storeReceivedEvent("evt-exhausted", job.BREEZE_RECONCILE_MAX_ATTEMPTS, 20 * 60_000);
    const result = await job.runBreezeReconciliationSweep();
    expect(result.exhausted).toBe(1);
    expect(result.claimed).toBe(0);
    const row = await T.BreezeWebhookEvent.findByPk(id);
    expect(row?.status).toBe("reconciliation_required");
    expect(row?.outcome_code).toBe("RETRY_EXHAUSTED");
    expect(row?.attempts).toBe(job.BREEZE_RECONCILE_MAX_ATTEMPTS);
    const alert = await T.BreezeReconciliationAlert.findOne({ where: { alert_key: `retry_budget_exhausted:${id}` } });
    expect(alert?.alert_kind).toBe("retry_budget_exhausted");
  });

  it("crash recovery: a worker that claimed and died leaves a lapsed lease, and a later sweep reclaims and processes the event", async () => {
    // A crashed worker bumped attempts to 2 and stopped; its lease (10 min) has lapsed.
    const id = await storeReceivedEvent("evt-crashed", 2, 11 * 60_000);
    const result = await job.runBreezeReconciliationSweep();
    expect(result.claimed).toBe(1);
    const row = await T.BreezeWebhookEvent.findByPk(id);
    expect(row?.attempts).toBe(3); // recovered, not stuck
    expect(row?.status).toBe("received"); // still held by the unit gate, but no longer claimed-and-dead
    expect(await T.Payment.count({ where: { provider: "breeze", provider_order_id: `BRZC-${PUBLIC_ID}` } })).toBe(0);
  });

  it("a live worker's fresh claim (inside the lease) is never raced by a second sweep", async () => {
    const id = await storeReceivedEvent("evt-live", 2, 2 * 60_000);
    const result = await job.runBreezeReconciliationSweep();
    expect(result.due).toBe(0);
    expect(result.claimed).toBe(0);
    expect((await T.BreezeWebhookEvent.findByPk(id))?.attempts).toBe(2);
  });

  it("unresolved checkouts past the expected duration raise an alert and are never auto-resolved", async () => {
    await T.BreezeCheckoutSession.update({ created_at: new Date(Date.now() - 3 * 60 * 60 * 1000) } as never, { where: { public_id: PUBLIC_ID } });
    await db.sequelize.query("UPDATE breeze_checkout_sessions SET created_at = NOW() - INTERVAL 3 HOUR WHERE public_id = ?", { replacements: [PUBLIC_ID] });
    const result = await job.runBreezeReconciliationSweep();
    expect(result.unresolvedCheckouts).toBe(1);
    const alert = await T.BreezeReconciliationAlert.findOne({ where: { alert_key: `checkout_unresolved_too_long:${SESSION_ID}` } });
    expect(alert?.alert_kind).toBe("checkout_unresolved_too_long");
    const session = await T.BreezeCheckoutSession.findOne({ where: { public_id: PUBLIC_ID } });
    expect(session?.processing_status).toBe("awaiting_webhook");
    expect(session?.order_id).toBeNull();
  });


  it("terminal reconciliation rows (business outcomes) are never auto-replayed", async () => {
    const id = await storeReceivedEvent("evt-terminal", 1, 10 * 60_000, "reconciliation_required");
    const result = await job.runBreezeReconciliationSweep();
    expect(result.claimed).toBe(0);
    const row = await T.BreezeWebhookEvent.findByPk(id);
    expect(row?.attempts).toBe(1);
  });

  it("a stored payload that no longer matches the documented schema is kept for manual review", async () => {
    const id = await storeReceivedEvent("evt-bad-payload", 1, 10 * 60_000);
    await db.sequelize.query("UPDATE breeze_webhook_events SET payload = ? WHERE id = ?", { replacements: [JSON.stringify({ nope: true }), id] });
    // The payload UPDATE refreshes updated_at (ON UPDATE CURRENT_TIMESTAMP), so age the row again.
    await db.sequelize.query("UPDATE breeze_webhook_events SET updated_at = NOW() - INTERVAL 1500 SECOND WHERE id = ?", { replacements: [id] });
    await job.runBreezeReconciliationSweep();
    const row = await T.BreezeWebhookEvent.findByPk(id);
    expect(row?.status).toBe("reconciliation_required");
    expect(row?.outcome_code).toBe("STORED_PAYLOAD_INVALID");
  });

  // Must run last: stop() sets the module-level flag that later sweeps honour.
  it("shutdown: once stop is requested, a sweep claims nothing new", async () => {
    await storeReceivedEvent("evt-shutdown", 1, 20 * 60_000);
    job.stopBreezeReconciliationScheduler();
    const result = await job.runBreezeReconciliationSweep();
    expect(result.stopped).toBe(true);
    expect(result.claimed).toBe(0);
  });
});
