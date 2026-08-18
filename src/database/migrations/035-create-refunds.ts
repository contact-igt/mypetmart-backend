import { QueryTypes } from "sequelize";

import { createInitialSchemaTable, dropInitialSchemaTable, type MigrationArguments } from "./migration-helpers.js";
import { getInitialSchemaTable } from "./schema-definition.js";

const table = getInitialSchemaTable("refunds");

export async function up({ context }: MigrationArguments): Promise<void> {
  await createInitialSchemaTable(context, table);

  // Same pattern as 027-create-wishlists.ts: refunds is created after
  // 022-create-id-sequences.ts's one-time backfill, so it needs its own seed
  // row for db:schema:verify's "every business table has an id_sequences
  // row" check to pass immediately after migrate.
  await context.sequelize.query(
    "INSERT INTO `id_sequences` (`sequence_name`, `next_value`, `updated_at`) VALUES (?, 1, NOW()) ON DUPLICATE KEY UPDATE `sequence_name` = `sequence_name`",
    { replacements: [table.tableName], type: QueryTypes.INSERT }
  );
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query("DELETE FROM `id_sequences` WHERE `sequence_name` = ?", {
    replacements: [table.tableName],
    type: QueryTypes.DELETE
  });
  await dropInitialSchemaTable(context, table);
}
