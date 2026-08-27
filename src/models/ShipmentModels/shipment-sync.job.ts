import { Op } from "sequelize";

import { shippingConfig } from "../../config/shipping.config.js";
import { Shipment } from "../../database/tables/index.js";
import { logger } from "../../utils/logger.js";
import { ShipmentService, TERMINAL } from "./shipment.service.js";

// No cron/queue/scheduler library exists anywhere in this backend (checked
// package.json and the full src tree) — per this phase's own instruction
// not to introduce one, this is a plain setInterval loop, the same
// dependency-free approach the rest of this codebase already uses for
// recurring concerns (see server.ts's own timers for graceful-shutdown
// safety). Batch size mirrors the task's own "50 shipments per batch" example.
const BATCH_SIZE = 50;
const SYNC_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes between scheduler ticks
const STALE_AFTER_MS = 15 * 60 * 1000; // a shipment is "due" once its last sync is this old (or has none)

// "provider_status_unknown" is deliberately excluded alongside the terminal
// statuses, even though the task only names delivered/rto_delivered/cancelled.
// That status means either (a) shipment creation returned no AWB — in which
// case tracking_number is null anyway and the query below already excludes
// it — or (b) an admin cancel/reattempt/RTO action has claimed the row via
// claimProviderMutation (shipment.service.ts) and is mid-flight, with a
// provider_status "dispatch pending" marker that claim's own idempotency
// check depends on. ingest() (called by refresh()) unconditionally
// overwrites provider_status with iThink's live tracking value — running an
// automatic refresh against a shipment in that specific window risks
// clobbering the pending-action marker. Skipping it here costs nothing (the
// next scheduler tick picks the shipment back up once the in-flight action
// resolves and moves it to a normal status) and avoids interfering with an
// admin-initiated action in progress.
const SYNC_EXCLUDED_STATUSES = [...TERMINAL, "provider_status_unknown"] as const;

export type ShipmentSyncBatchResult = {
  attempted: number;
  succeeded: number;
  failed: number;
};

/**
 * Finds shipments due for a tracking refresh and syncs each one by calling
 * the existing ShipmentService.refresh(id) — never IThinkClient.track()
 * directly, so API call, response parsing, dedup'd event creation, status
 * advancement and notification dispatch all stay exactly as already
 * implemented (see refresh()/ingest() in shipment.service.ts). One
 * shipment's failure is caught and logged, never aborting the rest of the
 * batch — the same "don't let one bad row stop the others" precedent the
 * existing bulkUpdateStatus (OrderModels) already follows.
 */
export async function runShipmentSyncBatch(): Promise<ShipmentSyncBatchResult> {
  if (shippingConfig.provider !== "ithink" || !shippingConfig.ready) {
    // Matches assertConfigured()'s own gate elsewhere in this module —
    // skip quietly rather than querying for shipments we could never
    // actually sync (every iThink call would fail credentials() immediately).
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const due = await Shipment.findAll({
    where: {
      tracking_number: { [Op.ne]: null },
      status: { [Op.notIn]: [...SYNC_EXCLUDED_STATUSES] },
      [Op.or]: [{ last_synced_at: null }, { last_synced_at: { [Op.lt]: staleBefore } }]
    },
    order: [["last_synced_at", "ASC"]],
    limit: BATCH_SIZE
  });

  let succeeded = 0;
  let failed = 0;
  for (const shipment of due) {
    try {
      await ShipmentService.refresh(shipment.id);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      logger.warn({ err: error, shipmentId: shipment.id }, "shipment sync: refresh failed for one shipment, continuing batch");
    }
  }

  if (due.length > 0) {
    logger.info({ attempted: due.length, succeeded, failed }, "shipment sync: batch complete");
  }

  return { attempted: due.length, succeeded, failed };
}

let timer: NodeJS.Timeout | null = null;

/**
 * Starts the background interval — idempotent (calling twice is a no-op).
 * Runs one batch immediately (fire-and-forget, errors caught) so a freshly
 * restarted server doesn't wait a full interval before catching up on
 * already-stale shipments, then repeats every SYNC_INTERVAL_MS.
 */
export function startShipmentSyncScheduler(): void {
  if (timer) return;
  const tick = () => {
    void runShipmentSyncBatch().catch((error: unknown) => {
      logger.error({ err: error }, "shipment sync: batch run failed unexpectedly");
    });
  };
  tick();
  timer = setInterval(tick, SYNC_INTERVAL_MS);
  timer.unref();
}

export function stopShipmentSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
