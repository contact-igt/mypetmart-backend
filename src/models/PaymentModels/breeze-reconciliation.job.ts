import { Op } from "sequelize";

import { BreezeCheckoutSession, BreezeWebhookEvent } from "../../database/tables/index.js";
import { logger } from "../../utils/logger.js";
import { raiseBreezeAlert } from "./breeze-alerts.service.js";
import { BreezeOrderCreateService } from "./breeze-order-create.service.js";
import { breezeOrderCreateSchema } from "./breeze-order-create.schema.js";

// Durable reconciliation sweep for Breeze Order Create webhook events.
//
// Scope: events still "received" — a transient failure, a failed acknowledgement
// write, or the amount unit not yet configured. Terminal business outcomes
// (amount mismatch, COD, partial payment, unknown status, ...) are NOT retried
// automatically; replaying them only re-derives the same answer. They are for
// staff (see breeze-reconciliation.service.ts).
//
// Claim and crash recovery:
// - A worker claims an event with a compare-and-set on the integer `attempts`
//   column (the winning claim bumps it). Two sweeps cannot both process a row.
// - A claim is a LEASE of at least BREEZE_RECONCILE_LEASE_MS. A worker that
//   crashes after claiming leaves the row "received" with a bumped attempts count;
//   once its lease has lapsed, any later sweep reclaims it. Nothing stays claimed
//   forever. A live worker finishing inside the lease is never raced.
// - Backoff per event: 1 minute, doubling, capped at 6 hours (never shorter than
//   the lease).
// - After BREEZE_RECONCILE_MAX_ATTEMPTS the event moves to
//   reconciliation_required (RETRY_EXHAUSTED) and an alert is raised.
// - Financial work is delegated to BreezeOrderCreateService.handle, which keeps
//   the two-phase bridge, the amount/currency/unknown-status gates and
//   PaymentFinalizationService. Nothing here marks money paid directly.
// - No provider API call is made, so no transaction is held across network I/O.

export const BREEZE_RECONCILE_INTERVAL_MS = 5 * 60 * 1000;
export const BREEZE_RECONCILE_BATCH_SIZE = 25;
export const BREEZE_RECONCILE_BASE_BACKOFF_MS = 60 * 1000;
export const BREEZE_RECONCILE_MAX_BACKOFF_MS = 6 * 60 * 60 * 1000;
export const BREEZE_RECONCILE_LEASE_MS = 10 * 60 * 1000;
export const BREEZE_RECONCILE_MAX_ATTEMPTS = 12;
// An awaiting_webhook checkout older than this is surfaced for staff.
export const BREEZE_CHECKOUT_EXPECTED_DURATION_MS = 2 * 60 * 60 * 1000;

export function reconciliationBackoffMs(attempts: number): number {
  const exponent = Math.max(0, attempts - 1);
  const backoff = Math.min(BREEZE_RECONCILE_BASE_BACKOFF_MS * 2 ** exponent, BREEZE_RECONCILE_MAX_BACKOFF_MS);
  return Math.max(backoff, BREEZE_RECONCILE_LEASE_MS);
}

export type BreezeReconciliationResult = {
  due: number;
  claimed: number;
  processed: number;
  failed: number;
  exhausted: number;
  unresolvedCheckouts: number;
  stopped: boolean;
};

let stopRequested = false;

/** Events eligible for an automatic retry, oldest first, respecting lease and backoff. */
async function findDueEvents(now: Date): Promise<BreezeWebhookEvent[]> {
  const candidates = await BreezeWebhookEvent.findAll({
    where: { event_kind: "order_create", status: "received", attempts: { [Op.lt]: BREEZE_RECONCILE_MAX_ATTEMPTS } },
    order: [["updated_at", "ASC"]],
    limit: BREEZE_RECONCILE_BATCH_SIZE * 4
  });
  return candidates.filter((row) => now.getTime() - new Date(row.updated_at).getTime() >= reconciliationBackoffMs(row.attempts));
}

/**
 * Compare-and-set claim on the integer attempts counter. The winning claim bumps
 * attempts and refreshes updated_at (which starts the lease), so a second sweep
 * holding the same snapshot matches zero rows.
 */
async function claimEvent(row: BreezeWebhookEvent): Promise<boolean> {
  const [affected] = await BreezeWebhookEvent.update(
    { attempts: row.attempts + 1, updated_at: new Date() },
    { where: { id: row.id, event_kind: "order_create", status: "received", attempts: row.attempts } }
  );
  return affected === 1;
}

async function markExhausted(now: Date): Promise<number> {
  const exhausted = await BreezeWebhookEvent.findAll({
    attributes: ["id", "event_id", "attempts"],
    where: { event_kind: "order_create", status: "received", attempts: { [Op.gte]: BREEZE_RECONCILE_MAX_ATTEMPTS } }
  });
  for (const row of exhausted) {
    const [affected] = await BreezeWebhookEvent.update(
      { status: "reconciliation_required", outcome_code: "RETRY_EXHAUSTED", updated_at: now },
      { where: { id: row.id, status: "received", attempts: { [Op.gte]: BREEZE_RECONCILE_MAX_ATTEMPTS } } }
    );
    if (affected === 1) {
      await raiseBreezeAlert("retry_budget_exhausted", String(row.id), { eventId: row.id, attempts: row.attempts, outcomeCode: "RETRY_EXHAUSTED" });
    }
  }
  return exhausted.length;
}

/** Awaiting-webhook checkouts past the expected duration: surfaced, never auto-resolved. */
async function surfaceUnresolvedCheckouts(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - BREEZE_CHECKOUT_EXPECTED_DURATION_MS);
  const stale = await BreezeCheckoutSession.findAll({
    attributes: ["id", "created_at"],
    where: { processing_status: "awaiting_webhook", order_id: null, created_at: { [Op.lt]: cutoff } }
  });
  for (const row of stale) {
    const ageMinutes = Math.round((now.getTime() - new Date(row.created_at).getTime()) / 60000);
    await raiseBreezeAlert("checkout_unresolved_too_long", String(row.id), { sessionId: row.id, ageMinutes, reason: "awaiting_webhook" });
  }
  return stale.length;
}

function parseStoredPayload(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

/**
 * One reconciliation pass. Safe to run concurrently and from a manual trigger:
 * each event is processed at most once per claim, and the bridge is idempotent
 * for every event it has already concluded.
 */
export async function runBreezeReconciliationSweep(now: Date = new Date()): Promise<BreezeReconciliationResult> {
  const exhausted = await markExhausted(now);
  const unresolvedCheckouts = await surfaceUnresolvedCheckouts(now);
  const due = await findDueEvents(now);
  const result: BreezeReconciliationResult = { due: due.length, claimed: 0, processed: 0, failed: 0, exhausted, unresolvedCheckouts, stopped: false };

  for (const row of due.slice(0, BREEZE_RECONCILE_BATCH_SIZE)) {
    // Shutdown: finish nothing new once stop was requested. The current event (if any)
    // completed before this check; anything unclaimed is simply picked up after restart.
    if (stopRequested) {
      result.stopped = true;
      break;
    }
    if (!(await claimEvent(row))) continue;
    result.claimed += 1;

    const parsed = breezeOrderCreateSchema.safeParse(parseStoredPayload(row.payload));
    if (!parsed.success) {
      // Stored evidence no longer matches the documented schema: keep it for a human.
      await BreezeWebhookEvent.update({ status: "reconciliation_required", outcome_code: "STORED_PAYLOAD_INVALID" }, { where: { id: row.id } });
      result.failed += 1;
      continue;
    }

    try {
      await BreezeOrderCreateService.handle(parsed.data, { alreadyCountedAttempt: true });
      result.processed += 1;
    } catch (error) {
      // handle() left the event "received"; it backs off and is retried after the lease.
      result.failed += 1;
      logger.error({ err: error, eventId: row.event_id, attempts: row.attempts + 1 }, "breeze reconciliation: retry failed, will retry after backoff");
    }
  }

  logger.info({ ...result }, "breeze reconciliation: sweep complete");
  return result;
}

let timer: NodeJS.Timeout | null = null;

export function startBreezeReconciliationScheduler(): void {
  if (timer) return;
  stopRequested = false;
  timer = setInterval(() => {
    void runBreezeReconciliationSweep().catch((error: unknown) => {
      logger.error({ err: error }, "breeze reconciliation: sweep failed");
    });
  }, BREEZE_RECONCILE_INTERVAL_MS);
}

/** Stops scheduling and makes any in-flight sweep finish its current event and stop. */
export function stopBreezeReconciliationScheduler(): void {
  stopRequested = true;
  if (timer) clearInterval(timer);
  timer = null;
}
