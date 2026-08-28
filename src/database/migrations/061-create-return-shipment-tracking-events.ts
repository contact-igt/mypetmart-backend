import { QueryTypes } from "sequelize";

import { createInitialSchemaTable, dropInitialSchemaTable, type MigrationArguments } from "./migration-helpers.js";
import { getInitialSchemaTable } from "./schema-definition.js";

const table = getInitialSchemaTable("return_shipment_tracking_events");

export async function up({ context }: MigrationArguments): Promise<void> {
  await createInitialSchemaTable(context, table);
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
