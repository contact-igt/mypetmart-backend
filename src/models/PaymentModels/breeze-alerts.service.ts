import { QueryTypes } from "sequelize";

import { DATABASE_TABLE_NAMES, type BreezeAlertKind } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { BreezeReconciliationAlert } from "../../database/tables/index.js";
import { logger } from "../../utils/logger.js";

// Operational alerts for Breeze reconciliation.
//
// Delivery channel: the application's structured logger (the same channel the
// rest of the backend uses for operational signals; a paging/email integration
// can subscribe to these log lines). Delivery state is recorded per alert row.
//
// Storm control:
// - One row per alert_key (kind + discriminator). Repeats increment `occurrences`
//   atomically (INSERT ... ON DUPLICATE KEY UPDATE) instead of creating rows.
// - An alert key is delivered once per DELIVERY_WINDOW_MS. Repeats inside the
//   window are counted, not sent.
//
// Privacy: `detail` is restricted to an allow-list of short scalar fields. Keys
// that look like personal data or credentials are dropped, never logged.

export const BREEZE_ALERT_DELIVERY_WINDOW_MS = 24 * 60 * 60 * 1000;

const ALLOWED_DETAIL_KEYS = new Set([
  "eventId",
  "sessionId",
  "orderId",
  "paymentId",
  "attempts",
  "outcomeCode",
  "errorCode",
  "status",
  "currency",
  "count",
  "ageMinutes",
  "reason"
]);

export type BreezeAlertDetail = Record<string, string | number | boolean | null>;

export function sanitizeAlertDetail(detail: Record<string, unknown>): BreezeAlertDetail {
  const clean: BreezeAlertDetail = {};
  for (const [key, value] of Object.entries(detail)) {
    if (!ALLOWED_DETAIL_KEYS.has(key)) continue;
    if (typeof value === "number" && Number.isFinite(value)) clean[key] = value;
    else if (typeof value === "boolean" || value === null) clean[key] = value;
    else if (typeof value === "string") clean[key] = value.slice(0, 80);
  }
  return clean;
}

/**
 * Records an occurrence of an operational condition and delivers it at most once
 * per window. Never throws into the payment path: an alert failure is logged and
 * recorded as delivery_status = failed, but never changes money or the caller's
 * outcome.
 */
export async function raiseBreezeAlert(kind: BreezeAlertKind, discriminator: string, detail: Record<string, unknown> = {}): Promise<void> {
  const alertKey = `${kind}:${discriminator}`.slice(0, 190);
  const safeDetail = sanitizeAlertDetail(detail);
  try {
    const id = await sequelize.transaction((t) => IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.breezeReconciliationAlerts, t));
    await sequelize.query(
      `INSERT INTO \`${DATABASE_TABLE_NAMES.breezeReconciliationAlerts}\`
        (\`id\`, \`alert_key\`, \`alert_kind\`, \`occurrences\`, \`first_seen_at\`, \`last_seen_at\`, \`delivery_status\`, \`detail\`, \`created_at\`, \`updated_at\`)
       VALUES (:id, :alertKey, :kind, 1, NOW(), NOW(), 'pending', :detail, NOW(), NOW())
       ON DUPLICATE KEY UPDATE \`occurrences\` = \`occurrences\` + 1, \`last_seen_at\` = NOW(), \`updated_at\` = NOW()`,
      { replacements: { id, alertKey, kind, detail: JSON.stringify(safeDetail) }, type: QueryTypes.INSERT }
    );

    const row = await BreezeReconciliationAlert.findOne({ where: { alert_key: alertKey } });
    if (!row) return;
    const lastDelivered = row.delivered_at ? new Date(row.delivered_at).getTime() : 0;
    const due = row.delivery_status !== "delivered" || Date.now() - lastDelivered >= BREEZE_ALERT_DELIVERY_WINDOW_MS;
    if (!due) return;

    try {
      logger.error({ alertKind: kind, alertKey, occurrences: row.occurrences, detail: safeDetail }, "breeze reconciliation alert");
      await BreezeReconciliationAlert.update({ delivery_status: "delivered", delivered_at: new Date() }, { where: { id: row.id } });
    } catch (deliveryError) {
      await BreezeReconciliationAlert.update({ delivery_status: "failed" }, { where: { id: row.id } });
      logger.error({ err: deliveryError, alertKey }, "breeze reconciliation alert: delivery failed");
    }
  } catch (error) {
    // Alerting is best-effort by design: it must never fail a webhook or a payment.
    logger.error({ err: error, alertKind: kind }, "breeze reconciliation alert: could not be recorded");
  }
}
