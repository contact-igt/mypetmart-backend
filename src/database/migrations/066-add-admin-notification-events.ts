import type { MigrationContext } from "./migration-helpers.js";

// Adds the operational admin-team event types (Admin Commerce Email
// Notifications). Additive ENUM extension only — the exact pattern migrations
// 032 / 037 / 057 / 062 already use for notification_log.event_type. No
// customer event value is removed or renamed; existing rows are untouched.
//
// Why a migration is needed at all: notification_log's idempotency key is the
// UNIQUE (event_type, entity_type, entity_id) triple, which carries no
// "audience" dimension. Giving the admin copy of an event its own durable,
// non-colliding dedupe claim therefore requires its own event_type value —
// there is no schema-free way to represent it (event_type is a strict MySQL
// ENUM). This is the "report a genuine schema limitation before expanding
// scope" case from the task brief.
const PREVIOUS_VALUES = [
  "ORDER_PLACED", "PAYMENT_SUCCESSFUL", "PAYMENT_FAILED", "ORDER_PROCESSING", "ORDER_SHIPPED", "ORDER_OUT_FOR_DELIVERY", "ORDER_DELIVERED",
  "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_REJECTED", "REFUND_INITIATED", "REFUND_SUCCEEDED", "REFUND_FAILED",
  "REPLACEMENT_APPROVED", "REPLACEMENT_STOCK_UNAVAILABLE", "REPLACEMENT_SHIPPED", "REPLACEMENT_COMPLETED",
  "SHIPMENT_CREATED", "SHIPMENT_RTO_INITIATED", "SHIPMENT_DELIVERY_FAILED",
  "RETURN_PICKUP_CREATED", "RETURN_PICKED_UP", "RETURN_DELIVERED"
];

const ADMIN_VALUES = [
  "ADMIN_ORDER_PLACED", "ADMIN_PAYMENT_RECEIVED", "ADMIN_PAYMENT_FAILED", "ADMIN_COD_CONFIRMED",
  "ADMIN_ORDER_PROCESSING", "ADMIN_ORDER_SHIPPED", "ADMIN_ORDER_DELIVERED", "ADMIN_ORDER_CANCELLED",
  "ADMIN_SHIPMENT_CREATED", "ADMIN_COMMERCE_EXCEPTION", "ADMIN_RETURN_REQUESTED"
];

const NEW_VALUES = [...PREVIOUS_VALUES, ...ADMIN_VALUES];

function enumList(values: string[]): string {
  return values.map((v) => `'${v}'`).join(",");
}

export async function up({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  await sequelize.query(`ALTER TABLE \`notification_log\` MODIFY COLUMN \`event_type\` ENUM(${enumList(NEW_VALUES)}) NOT NULL`);
}

export async function down({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  const [rows] = (await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM \`notification_log\` WHERE \`event_type\` IN (${enumList(ADMIN_VALUES)})`
  )) as [Array<{ cnt: number }>, unknown];
  const count = rows[0]?.cnt ?? 0;
  if (count > 0) {
    throw new Error(
      `Migration 066 rollback refused: ${count} notification_log row(s) use an admin event type being removed. ` +
      "Manual intervention required before reverting this migration."
    );
  }
  await sequelize.query(`ALTER TABLE \`notification_log\` MODIFY COLUMN \`event_type\` ENUM(${enumList(PREVIOUS_VALUES)}) NOT NULL`);
}
