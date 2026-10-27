/* eslint-disable */
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Staff reconciliation API: authentication, role gates, masking, claim-safe retry,
// super-admin release and audit rows. Real users and sessions are used.

const BASE = "/api/v1/admin/breeze";
const ADMIN_ID = 990801;
const SUPER_ID = 990802;
const CUSTOMER_ID = 990803;
const CART_ID = 990850;
const SESSION_ID = 990850;
const PUBLIC_ID = crypto.randomBytes(16).toString("hex");

const ADDRESS = {
  name: "Admin Test Customer",
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

function eventBody(eventId: string, status: string | null = "SUCCESS") {
  return {
    id: eventId,
    eventName: "ORDER_SUCCEEDED",
    content: {
      orderId: `bz-${eventId}`,
      txnId: `txn-${eventId}`,
      ...(status === null ? {} : { status }),
      offers: [],
      payment: { paymentMethod: "UPI", paymentMethodType: "UPI", amount: 500, currency: "INR" },
      billingAddress: ADDRESS,
      shippingAddress: ADDRESS,
      customer: { customerId: "c-admin", phoneNumber: "9876543210", countryCode: "+91", emailAddress: "admin-test@example.com" },
      cart: { id: PUBLIC_ID, breezeCartId: `bzc-${eventId}`, initialPrice: 500, totalPrice: 500, totalDiscount: 0, itemCount: 1, items: [], currency: "INR" }
    }
  };
}

describe("Breeze staff reconciliation API", () => {
  let db: typeof import("../../src/database/index.js");
  let T: typeof import("../../src/database/tables/index.js");
  let app: typeof import("../../src/app.js").app;
  let adminToken = "";
  let superToken = "";
  let customerToken = "";

  async function mintAdmin(id: number, role: "admin" | "super_admin") {
    const { PasswordService } = await import("../../src/services/auth/password.service.js");
    const { SessionService } = await import("../../src/services/auth/session.service.js");
    const { TokenService } = await import("../../src/services/auth/token.service.js");
    await T.AuthSession.destroy({ where: { user_id: id }, force: true });
    await T.User.destroy({ where: { id }, force: true });
    const user = await T.User.create({ id, name: `Staff ${role}`, email: `staff-${id}@example.com`, password_hash: await PasswordService.hash("TestPass123!@#"), role, status: "active", reference_code: `STF-${id}` } as never);
    const { session } = await SessionService.createSession(user.id, "admin", null, null);
    return TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role, sessionType: "admin" });
  }

  async function mintCustomer(id: number) {
    const { PasswordService } = await import("../../src/services/auth/password.service.js");
    const { SessionService } = await import("../../src/services/auth/session.service.js");
    const { TokenService } = await import("../../src/services/auth/token.service.js");
    await T.AuthSession.destroy({ where: { user_id: id }, force: true });
    await T.User.destroy({ where: { id }, force: true });
    const user = await T.User.create({ id, name: "Customer", email: `cust-${id}@example.com`, password_hash: await PasswordService.hash("TestPass123!@#"), role: "customer", status: "active", reference_code: `CUS-${id}` } as never);
    const { session } = await SessionService.createSession(user.id, "customer", null, null);
    return TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role: "customer", sessionType: "customer" });
  }

  async function storeEvent(eventId: string, status: string | null, attempts = 1, state: "received" | "processed" = "received") {
    const id = await db.sequelize.transaction(async (t) => (await import("../../src/database/sequences/id-sequence.service.js")).IdSequenceService.allocateNextId("breeze_webhook_events", t));
    await T.BreezeWebhookEvent.create({ id, event_id: eventId, event_kind: "order_create", event_name: "ORDER_SUCCEEDED", session_public_id: PUBLIC_ID, status: state, payload: eventBody(eventId, status), attempts } as never);
    // Age the row past the lease so it is retry-eligible.
    await db.sequelize.query("UPDATE breeze_webhook_events SET updated_at = NOW() - INTERVAL 1500 SECOND WHERE id = ?", { replacements: [id] });
    return id;
  }

  beforeAll(async () => {
    db = await import("../../src/database/index.js");
    await db.connectDatabase();
    T = await import("../../src/database/tables/index.js");
    app = (await import("../../src/app.js")).app;
    adminToken = await mintAdmin(ADMIN_ID, "admin");
    superToken = await mintAdmin(SUPER_ID, "super_admin");
    customerToken = await mintCustomer(CUSTOMER_ID);
  }, 60_000);

  afterAll(async () => {
    await T.BreezeAdminActionRecord.destroy({ where: {} });
    await T.BreezeWebhookEvent.destroy({ where: {} });
    await T.BreezeCheckoutSession.destroy({ where: {} });
    await T.Cart.destroy({ where: { id: CART_ID }, force: true });
    for (const id of [ADMIN_ID, SUPER_ID, CUSTOMER_ID]) {
      await T.AuthSession.destroy({ where: { user_id: id }, force: true });
      await T.User.destroy({ where: { id }, force: true });
    }
    await db.disconnectDatabase();
  });

  beforeEach(async () => {
    await T.BreezeAdminActionRecord.destroy({ where: {} });
    await T.BreezeWebhookEvent.destroy({ where: {} });
    await T.BreezeCheckoutSession.destroy({ where: {} });
    if (!(await T.Cart.findByPk(CART_ID))) {
      await T.Cart.create({ id: CART_ID, status: "active", guest_token_hash: "s".repeat(64) } as never);
    }
    await T.BreezeCheckoutSession.create({
      id: SESSION_ID,
      public_id: PUBLIC_ID,
      user_id: null,
      guest_identity_hash: "s".repeat(64),
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

  // ------------------------------------------------------------ authentication
  it("refuses an unauthenticated request (401)", async () => {
    const res = await request(app).get(`${BASE}/reconciliation`);
    expect(res.status).toBe(401);
  });

  it("refuses a customer token (403/401), never exposing reconciliation data", async () => {
    const res = await request(app).get(`${BASE}/reconciliation`).set("Authorization", `Bearer ${customerToken}`);
    expect([401, 403]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain("webhookState");
  });

  // ---------------------------------------------------------------- read model
  it("admin list shows state, references and retry eligibility, and never shows payloads or contact details", async () => {
    await storeEvent("evt-list-1", "SUCCESS");
    const res = await request(app).get(`${BASE}/reconciliation`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    const data = res.body.data;
    expect(data.sessions.length).toBe(1);
    expect(data.sessions[0]).toMatchObject({ processingStatus: "awaiting_webhook", launchStatus: "created" });
    expect(data.events[0]).toMatchObject({ providerEventId: "evt-list-1", webhookState: "received", retryEligible: true });
    const text = JSON.stringify(res.body);
    for (const forbidden of ["payload", "emailAddress", "phoneNumber", "admin-test@example.com", "9876543210", "221B Baker", "BEGIN", "PRIVATE"]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("a refund report is shown as reported_unverified, never as completed", async () => {
    await storeEvent("evt-refund-1", "REFUNDED", 1);
    await T.BreezeWebhookEvent.update({ outcome_code: "PROVIDER_REFUND_REPORTED", status: "reconciliation_required" }, { where: { event_id: "evt-refund-1" } });
    const res = await request(app).get(`${BASE}/reconciliation`).set("Authorization", `Bearer ${adminToken}`);
    const ev = res.body.data.events.find((e: any) => e.providerEventId === "evt-refund-1");
    expect(ev.refundState).toBe("reported_unverified");
    expect(JSON.stringify(res.body)).not.toMatch(/"refundState":"(completed|refunded)"/);
  });

  // ----------------------------------------------------------------- retry
  it("manual retry requires a reason (422) and writes nothing", async () => {
    const id = await storeEvent("evt-noreason", "SUCCESS");
    const res = await request(app).post(`${BASE}/events/${id}/retry`).set("Authorization", `Bearer ${adminToken}`).send({});
    expect(res.status).toBe(422);
    expect(await T.BreezeAdminActionRecord.count()).toBe(0);
  });

  it("manual retry of a held event re-runs the gates: still held (unit unset), no Order, no Payment, audited", async () => {
    const id = await storeEvent("evt-held-retry", "SUCCESS");
    const res = await request(app).post(`${BASE}/events/${id}/retry`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Re-check after sandbox credentials were fixed" });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ webhookState: "received", httpStatus: 503 });
    expect(await T.Order.count()).toBe(0);
    expect(await T.Payment.count({ where: { provider: "breeze" } })).toBe(0);
    const audit = await T.BreezeAdminActionRecord.findOne({ where: { target_id: id } });
    expect(audit).toMatchObject({ action: "retry_event", target_type: "breeze_webhook_event", actor_user_id: ADMIN_ID });
    expect(audit?.reason).toMatch(/sandbox credentials/);
  });

  it("an unknown-status (absent) event is NOT turned into success by a manual retry", async () => {
    const id = await storeEvent("evt-unknown-retry", null);
    const res = await request(app).post(`${BASE}/events/${id}/retry`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Retry to check whether it finalizes" });
    expect(res.status).toBe(200);
    expect(await T.Order.count()).toBe(0);
    expect(await T.Payment.count({ where: { provider: "breeze" } })).toBe(0);
    const row = await T.BreezeWebhookEvent.findByPk(id);
    expect(row?.outcome_code).toBe("UNKNOWN_STATUS");
  });

  it("a concluded event cannot be retried (409 EVENT_NOT_RETRYABLE)", async () => {
    const id = await storeEvent("evt-concluded", "SUCCESS", 1, "received");
    await T.BreezeWebhookEvent.update({ status: "processed" }, { where: { id } });
    const res = await request(app).post(`${BASE}/events/${id}/retry`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Trying to retry a concluded event" });
    expect(res.status).toBe(409);
    expect(JSON.stringify(res.body)).toContain("EVENT_NOT_RETRYABLE");
  });

  // ---------------------------------------------------------------- release
  it("release is super_admin only: an admin is refused (403)", async () => {
    const res = await request(app).post(`${BASE}/sessions/${SESSION_ID}/release`).set("Authorization", `Bearer ${adminToken}`).send({ reason: "Checked dashboard: no capture", confirmation: "NO_PROVIDER_CAPTURE_CONFIRMED" });
    expect(res.status).toBe(403);
    expect((await T.BreezeCheckoutSession.findByPk(SESSION_ID))?.processing_status).toBe("awaiting_webhook");
  });

  it("release requires the explicit confirmation phrase (422)", async () => {
    const res = await request(app).post(`${BASE}/sessions/${SESSION_ID}/release`).set("Authorization", `Bearer ${superToken}`).send({ reason: "Checked dashboard: no capture" });
    expect(res.status).toBe(422);
    expect(JSON.stringify(res.body)).toContain("RELEASE_NOT_CONFIRMED");
  });

  it("super_admin release unblocks the customer, is audited, and refuses a session that has an order", async () => {
    const ok = await request(app).post(`${BASE}/sessions/${SESSION_ID}/release`).set("Authorization", `Bearer ${superToken}`).send({ reason: "Checked Breeze dashboard: no capture", confirmation: "NO_PROVIDER_CAPTURE_CONFIRMED" });
    expect(ok.status).toBe(200);
    const session = await T.BreezeCheckoutSession.findByPk(SESSION_ID);
    expect(session).toMatchObject({ processing_status: "released", status: "expired" });
    const guard = await import("../../src/models/PaymentModels/breeze-attempt-guard.js");
    expect(await guard.findBlockingAttempt({ type: "guest", tokenHash: "s".repeat(64) })).toBeNull();
    expect(await T.BreezeAdminActionRecord.count({ where: { action: "release_session", actor_user_id: SUPER_ID } })).toBe(1);

    // A session with an order can never be released (it could hide a capture).
    await T.BreezeCheckoutSession.update({ processing_status: "order_created", order_id: null }, { where: { id: SESSION_ID } });
    const order = await T.Order.findOne();
    const refused = await request(app).post(`${BASE}/sessions/${SESSION_ID}/release`).set("Authorization", `Bearer ${superToken}`).send({ reason: "Trying to release a paid checkout", confirmation: "NO_PROVIDER_CAPTURE_CONFIRMED" });
    expect(refused.status).toBe(409);
    expect(order).toBeNull();
  });
});
