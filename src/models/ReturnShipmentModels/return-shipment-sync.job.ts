import { Op } from "sequelize";

import { shippingConfig } from "../../config/shipping.config.js";
import { ReturnShipment } from "../../database/tables/index.js";
import { logger } from "../../utils/logger.js";
import { ReturnShipmentService } from "./return-shipment.service.js";

// Mirrors ShipmentModels/shipment-sync.job.ts exactly (same dependency-free
// setInterval approach, same batch/staleness constants) — kept as its own
// separate job, not a shared scheduler, since a reverse shipment is its own
// business entity with its own table (see return-shipment.service.ts).
const BATCH_SIZE = 50;
const SYNC_INTERVAL_MS = 10 * 60 * 1000;
const STALE_AFTER_MS = 15 * 60 * 1000;
const TERMINAL_STATUSES = ["delivered", "failed", "cancelled"] as const;

export type ReturnShipmentSyncBatchResult = { attempted: number; succeeded: number; failed: number };

export async function runReturnShipmentSyncBatch(): Promise<ReturnShipmentSyncBatchResult> {
  if (shippingConfig.provider !== "ithink" || !shippingConfig.ready) {
    return { attempted: 0, succeeded: 0, failed: 0 };
  }

  const staleBefore = new Date(Date.now() - STALE_AFTER_MS);
  const due = await ReturnShipment.findAll({
    where: {
      awb_number: { [Op.ne]: null },
      status: { [Op.notIn]: [...TERMINAL_STATUSES] },
      [Op.or]: [{ last_synced_at: null }, { last_synced_at: { [Op.lt]: staleBefore } }]
    },
    order: [["last_synced_at", "ASC"]],
    limit: BATCH_SIZE
  });

  let succeeded = 0;
  let failed = 0;
  for (const returnShipment of due) {
    try {
      await ReturnShipmentService.refresh(returnShipment.id);
      succeeded += 1;
    } catch (error) {
      failed += 1;
      logger.warn({ err: error, returnShipmentId: returnShipment.id }, "return shipment sync: refresh failed for one return shipment, continuing batch");
    }
  }

  if (due.length > 0) {
    logger.info({ attempted: due.length, succeeded, failed }, "return shipment sync: batch complete");
  }

  return { attempted: due.length, succeeded, failed };
}

let timer: NodeJS.Timeout | null = null;

export function startReturnShipmentSyncScheduler(): void {
  if (timer) return;
  const tick = () => {
    void runReturnShipmentSyncBatch().catch((error: unknown) => {
      logger.error({ err: error }, "return shipment sync: batch run failed unexpectedly");
    });
  };
  tick();
  timer = setInterval(tick, SYNC_INTERVAL_MS);
  timer.unref();
}

export function stopReturnShipmentSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
