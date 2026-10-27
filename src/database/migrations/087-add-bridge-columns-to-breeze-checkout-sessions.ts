import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

// Additive migration for databases that already ran 085 before the Order Create
// bridge existed (a fresh database gets these columns from 085 itself, so each
// step is skipped when its column is already present).
//
//   order_intent       — immutable, server-authoritative order lines captured
//                        when the Breeze cart was signed; the ONLY source the
//                        webhook may build an Order from.
//   breeze_cart_id / breeze_order_id / breeze_txn_id — distinct provider
//                        references (never interchangeable).
//   payment_id         — the single local Payment for this session.
//   processing_status  — webhook -> Order -> finalization bridge progress.
//   last_event_id / last_error_code — support/debug, no PII.

async function columnExists(context: MigrationArguments["context"], table: string, column: string): Promise<boolean> {
  const rows = await context.sequelize.query<{ columnName: string }>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column",
    { type: QueryTypes.SELECT, replacements: { table, column } }
  );
  return rows.length > 0;
}

const TABLE = "breeze_checkout_sessions";

export async function up({ context }: MigrationArguments): Promise<void> {
  if (await columnExists(context, TABLE, "order_intent")) {
    return;
  }
  await context.sequelize.query(`
    ALTER TABLE \`${TABLE}\`
      ADD COLUMN \`order_intent\` JSON NULL AFTER \`order_id\`,
      ADD COLUMN \`breeze_cart_id\` VARCHAR(190) NULL AFTER \`order_intent\`,
      ADD COLUMN \`breeze_order_id\` VARCHAR(190) NULL AFTER \`breeze_cart_id\`,
      ADD COLUMN \`breeze_txn_id\` VARCHAR(190) NULL AFTER \`breeze_order_id\`,
      ADD COLUMN \`payment_id\` INT UNSIGNED NULL AFTER \`breeze_txn_id\`,
      ADD COLUMN \`processing_status\` ENUM('awaiting_webhook','order_created','finalized','reconciliation_required','failed') NOT NULL DEFAULT 'awaiting_webhook' AFTER \`payment_id\`,
      ADD COLUMN \`last_event_id\` VARCHAR(190) NULL AFTER \`processing_status\`,
      ADD COLUMN \`last_error_code\` VARCHAR(80) NULL AFTER \`last_event_id\`,
      ADD UNIQUE KEY \`breeze_checkout_sessions_breeze_order_id_unique\` (\`breeze_order_id\`),
      ADD UNIQUE KEY \`breeze_checkout_sessions_breeze_txn_id_unique\` (\`breeze_txn_id\`),
      ADD UNIQUE KEY \`breeze_checkout_sessions_payment_id_unique\` (\`payment_id\`),
      ADD CONSTRAINT \`fk_breeze_checkout_sessions_payment_id\` FOREIGN KEY (\`payment_id\`) REFERENCES \`payments\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  if (!(await columnExists(context, TABLE, "order_intent"))) {
    return;
  }
  await context.sequelize.query(`
    ALTER TABLE \`${TABLE}\`
      DROP FOREIGN KEY \`fk_breeze_checkout_sessions_payment_id\`,
      DROP INDEX \`breeze_checkout_sessions_payment_id_unique\`,
      DROP INDEX \`breeze_checkout_sessions_breeze_txn_id_unique\`,
      DROP INDEX \`breeze_checkout_sessions_breeze_order_id_unique\`,
      DROP COLUMN \`last_error_code\`,
      DROP COLUMN \`last_event_id\`,
      DROP COLUMN \`processing_status\`,
      DROP COLUMN \`payment_id\`,
      DROP COLUMN \`breeze_txn_id\`,
      DROP COLUMN \`breeze_order_id\`,
      DROP COLUMN \`breeze_cart_id\`,
      DROP COLUMN \`order_intent\`;
  `);
}
