import { QueryTypes } from "sequelize";

import type { MigrationArguments } from "./migration-helpers.js";

// Additive: widens the bridge's processing_status ENUM with "released" (an
// audited admin release of an unresolved attempt). Existing values, rows and
// historical PayU/Breeze payments are untouched. Re-running is a no-op because
// MODIFY restates the full value list.
export async function up({ context }: MigrationArguments): Promise<void> {
  const rows = await context.sequelize.query<{ columnType: string }>(
    "SELECT column_type AS columnType FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'breeze_checkout_sessions' AND column_name = 'processing_status'",
    { type: QueryTypes.SELECT }
  );
  if (rows.length === 0 || rows[0]!.columnType.includes("'released'")) {
    return;
  }
  await context.sequelize.query(`
    ALTER TABLE \`breeze_checkout_sessions\`
      MODIFY \`processing_status\` ENUM('awaiting_webhook','order_created','finalized','reconciliation_required','failed','released') NOT NULL DEFAULT 'awaiting_webhook';
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  // Rows already in "released" must move back to a value the old enum accepts.
  // They were only ever awaiting_webhook sessions an admin released, so the
  // safe rollback state is reconciliation_required (never "failed"/paid).
  await context.sequelize.query("UPDATE `breeze_checkout_sessions` SET `processing_status` = 'reconciliation_required' WHERE `processing_status` = 'released'");
  await context.sequelize.query(`
    ALTER TABLE \`breeze_checkout_sessions\`
      MODIFY \`processing_status\` ENUM('awaiting_webhook','order_created','finalized','reconciliation_required','failed') NOT NULL DEFAULT 'awaiting_webhook';
  `);
}
