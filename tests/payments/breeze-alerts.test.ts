/* eslint-disable */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Alert storm control and privacy of alert detail.

describe("Breeze reconciliation alerts", () => {
  let db: typeof import("../../src/database/index.js");
  let T: typeof import("../../src/database/tables/index.js");
  let alerts: typeof import("../../src/models/PaymentModels/breeze-alerts.service.js");

  beforeAll(async () => {
    db = await import("../../src/database/index.js");
    await db.connectDatabase();
    T = await import("../../src/database/tables/index.js");
    alerts = await import("../../src/models/PaymentModels/breeze-alerts.service.js");
  }, 60_000);

  afterAll(async () => {
    await db.disconnectDatabase();
  });

  beforeEach(async () => {
    await T.BreezeReconciliationAlert.destroy({ where: {} });
  });

  it("repeats of one condition increment occurrences atomically and create one row", async () => {
    await alerts.raiseBreezeAlert("provider_reference_conflict", "session-1", { sessionId: 1 });
    await alerts.raiseBreezeAlert("provider_reference_conflict", "session-1", { sessionId: 1 });
    await alerts.raiseBreezeAlert("provider_reference_conflict", "session-1", { sessionId: 1 });
    const rows = await T.BreezeReconciliationAlert.findAll({ where: { alert_key: "provider_reference_conflict:session-1" } });
    expect(rows.length).toBe(1);
    expect(rows[0]!.occurrences).toBe(3);
  });

  it("delivers once per window: a repeat inside 24 hours does not re-deliver", async () => {
    await alerts.raiseBreezeAlert("retry_budget_exhausted", "event-9", { eventId: 9 });
    const first = await T.BreezeReconciliationAlert.findOne({ where: { alert_key: "retry_budget_exhausted:event-9" } });
    expect(first?.delivery_status).toBe("delivered");
    const deliveredAt = first!.delivered_at;
    await alerts.raiseBreezeAlert("retry_budget_exhausted", "event-9", { eventId: 9 });
    const second = await T.BreezeReconciliationAlert.findOne({ where: { alert_key: "retry_budget_exhausted:event-9" } });
    expect(second?.occurrences).toBe(2);
    expect(new Date(second!.delivered_at!).getTime()).toBe(new Date(deliveredAt!).getTime());
  });

  it("detail is allow-listed: personal data and credential-like keys are dropped", async () => {
    await alerts.raiseBreezeAlert("amount_or_currency_mismatch", "event-privacy", {
      eventId: "evt-1",
      email: "customer@example.com",
      phoneNumber: "9876543210",
      token: "secret-value",
      outcomeCode: "AMOUNT_MISMATCH"
    });
    const row = await T.BreezeReconciliationAlert.findOne({ where: { alert_key: "amount_or_currency_mismatch:event-privacy" } });
    const detail = typeof row!.detail === "string" ? JSON.parse(row!.detail) : row!.detail;
    expect(detail).toEqual({ eventId: "evt-1", outcomeCode: "AMOUNT_MISMATCH" });
    expect(JSON.stringify(row)).not.toMatch(/customer@example|9876543210|secret-value/);
  });

  it("the sanitizer caps string length and keeps only scalar values", () => {
    const clean = alerts.sanitizeAlertDetail({ eventId: "x".repeat(500), attempts: 3, nested: { a: 1 }, sessionId: null });
    expect(clean.eventId).toHaveLength(80);
    expect(clean.attempts).toBe(3);
    expect(clean.sessionId).toBeNull();
    expect("nested" in clean).toBe(false);
  });
});
