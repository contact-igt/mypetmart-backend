import type { MigrationContext } from "./migration-helpers.js";

// Adds the 3 new shipment-lifecycle event types Phase 1D.2 needs —
// SHIPMENT_CREATED (AWB booked), SHIPMENT_RTO_INITIATED, and
// SHIPMENT_DELIVERY_FAILED (NDR / delivery_exception, collapsed into one
// customer-facing event) — following the exact same additive ENUM-extension
// pattern already used by migrations 032 and 037.
const PREVIOUS_VALUES = [
  "ORDER_PLACED", "PAYMENT_SUCCESSFUL", "PAYMENT_FAILED", "ORDER_PROCESSING", "ORDER_SHIPPED", "ORDER_OUT_FOR_DELIVERY", "ORDER_DELIVERED",
  "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_REJECTED", "REFUND_INITIATED", "REFUND_SUCCEEDED", "REFUND_FAILED",
  "REPLACEMENT_APPROVED", "REPLACEMENT_STOCK_UNAVAILABLE", "REPLACEMENT_SHIPPED", "REPLACEMENT_COMPLETED"
];
const NEW_VALUES = [...PREVIOUS_VALUES, "SHIPMENT_CREATED", "SHIPMENT_RTO_INITIATED", "SHIPMENT_DELIVERY_FAILED"];

function enumList(values: string[]): string {
  return values.map((v) => `'${v}'`).join(",");
}

export async function up({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  await sequelize.query(`ALTER TABLE \`notification_log\` MODIFY COLUMN \`event_type\` ENUM(${enumList(NEW_VALUES)}) NOT NULL`);
}

export async function down({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  const newlyAdded = ["SHIPMENT_CREATED", "SHIPMENT_RTO_INITIATED", "SHIPMENT_DELIVERY_FAILED"];
  const [rows] = (await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM \`notification_log\` WHERE \`event_type\` IN (${enumList(newlyAdded)})`
  )) as [Array<{ cnt: number }>, unknown];
  const count = rows[0]?.cnt ?? 0;
  if (count > 0) {
    throw new Error(
      `Migration 057 rollback refused: ${count} notification_log row(s) use a shipment event type being removed. ` +
      "Manual intervention required before reverting this migration."
    );
  }
  await sequelize.query(`ALTER TABLE \`notification_log\` MODIFY COLUMN \`event_type\` ENUM(${enumList(PREVIOUS_VALUES)}) NOT NULL`);
}
