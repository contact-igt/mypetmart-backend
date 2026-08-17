import { QueryTypes } from "sequelize";

import { createInitialSchemaTable, dropInitialSchemaTable, type MigrationArguments } from "./migration-helpers.js";
import { getInitialSchemaTable } from "./schema-definition.js";

const table = getInitialSchemaTable("wishlists");

export async function up({ context }: MigrationArguments): Promise<void> {
  await createInitialSchemaTable(context, table);

  // Tables that existed when 022-create-id-sequences.ts ran were backfilled with a
  // starting id_sequences row automatically. wishlists is created after that migration,
  // so it needs the same seed row created here (IdSequenceService.allocateNextId can
  // self-initialize a missing row too, but seeding it explicitly keeps db:schema:verify's
  // "every business table has an id_sequences row" check green immediately after migrate).
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
