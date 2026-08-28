import type { MigrationContext } from "./migration-helpers.js";

// Adds the reverse-shipment notification events/entity type Phase F.1
// needs — RETURN_PICKUP_CREATED, RETURN_PICKED_UP, RETURN_DELIVERED, and
// the new "return_shipment" entity_type they're keyed by — following the
// exact same additive ENUM-extension pattern already used by migration 057.
const PREVIOUS_EVENT_VALUES = [
  "ORDER_PLACED", "PAYMENT_SUCCESSFUL", "PAYMENT_FAILED", "ORDER_PROCESSING", "ORDER_SHIPPED", "ORDER_OUT_FOR_DELIVERY", "ORDER_DELIVERED",
  "RETURN_REQUESTED", "RETURN_APPROVED", "RETURN_REJECTED", "REFUND_INITIATED", "REFUND_SUCCEEDED", "REFUND_FAILED",
  "REPLACEMENT_APPROVED", "REPLACEMENT_STOCK_UNAVAILABLE", "REPLACEMENT_SHIPPED", "REPLACEMENT_COMPLETED",
  "SHIPMENT_CREATED", "SHIPMENT_RTO_INITIATED", "SHIPMENT_DELIVERY_FAILED"
];
const NEW_EVENT_VALUES = [...PREVIOUS_EVENT_VALUES, "RETURN_PICKUP_CREATED", "RETURN_PICKED_UP", "RETURN_DELIVERED"];

const PREVIOUS_ENTITY_VALUES = ["order", "payment", "return", "refund", "replacement", "shipment"];
const NEW_ENTITY_VALUES = [...PREVIOUS_ENTITY_VALUES, "return_shipment"];

function enumList(values: string[]): string {
  return values.map((v) => `'${v}'`).join(",");
}

export async function up({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  await sequelize.query(`ALTER TABLE \`notification_log\` MODIFY COLUMN \`event_type\` ENUM(${enumList(NEW_EVENT_VALUES)}) NOT NULL`);
  await sequelize.query(`ALTER TABLE \`notification_log\` MODIFY COLUMN \`entity_type\` ENUM(${enumList(NEW_ENTITY_VALUES)}) NOT NULL`);
}

export async function down({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  const newlyAddedEvents = ["RETURN_PICKUP_CREATED", "RETURN_PICKED_UP", "RETURN_DELIVERED"];
  const [eventRows] = (await sequelize.query(
    `SELECT COUNT(*) AS cnt FROM \`notification_log\` WHERE \`event_type\` IN (${enumList(newlyAddedEvents)})`
  )) as [Array<{ cnt: number }>, unknown];
  if ((eventRows[0]?.cnt ?? 0) > 0) {
    throw new Error("Migration 062 rollback refused: notification_log row(s) use a return-shipment event type being removed. Manual intervention required before reverting this migration.");
  }

  const [entityRows] = (await sequelize.query(
    "SELECT COUNT(*) AS cnt FROM `notification_log` WHERE `entity_type` = 'return_shipment'"
  )) as [Array<{ cnt: number }>, unknown];
  if ((entityRows[0]?.cnt ?? 0) > 0) {
    throw new Error("Migration 062 rollback refused: notification_log row(s) use the return_shipment entity type being removed. Manual intervention required before reverting this migration.");
  }

  await sequelize.query(`ALTER TABLE \`notification_log\` MODIFY COLUMN \`entity_type\` ENUM(${enumList(PREVIOUS_ENTITY_VALUES)}) NOT NULL`);
  await sequelize.query(`ALTER TABLE \`notification_log\` MODIFY COLUMN \`event_type\` ENUM(${enumList(PREVIOUS_EVENT_VALUES)}) NOT NULL`);
}
