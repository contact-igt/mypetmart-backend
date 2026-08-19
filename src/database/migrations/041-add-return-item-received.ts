import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, nullable "physical item received back" confirmation on a
// ReturnRequest. Closes a real gap: refund initiation (type "return") and
// replacement approval (type "replacement") could otherwise trigger real
// money/stock movement off a customer-submitted photo + admin approval alone,
// with nowhere in the schema to record whether the original item ever
// actually arrived back. Set exactly once, by an admin, via
// ReturnService.markItemReceived — never automatic, never unset. NULL for
// every ReturnRequest until confirmed.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'return_requests' AND column_name = 'item_received_at'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`return_requests\`
      ADD COLUMN \`item_received_at\` DATETIME NULL AFTER \`evidence_image_url\`,
      ADD COLUMN \`item_received_by_admin_id\` INT UNSIGNED NULL AFTER \`item_received_at\`,
      ADD KEY \`return_requests_item_received_by_admin_id_idx\` (\`item_received_by_admin_id\`),
      ADD CONSTRAINT \`fk_return_requests_item_received_by_admin_id\` FOREIGN KEY (\`item_received_by_admin_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`return_requests\`
      DROP FOREIGN KEY \`fk_return_requests_item_received_by_admin_id\`,
      DROP KEY \`return_requests_item_received_by_admin_id_idx\`,
      DROP COLUMN \`item_received_by_admin_id\`,
      DROP COLUMN \`item_received_at\`;
  `);
}
