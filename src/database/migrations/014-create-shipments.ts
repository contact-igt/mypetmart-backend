import { createInitialSchemaTable, dropInitialSchemaTable, type MigrationArguments } from "./migration-helpers.js";
import { getInitialSchemaTable } from "./schema-definition.js";

const table = getInitialSchemaTable("shipments");

export async function up({ context }: MigrationArguments): Promise<void> {
  // replacements is introduced later (038). Migration 039 adds this FK once
  // both tables exist; the remaining final columns are safe on a clean install.
  const preReplacementTable = {
    ...table,
    createSql: table.createSql.replace(
      /\s*CONSTRAINT `fk_shipments_replacement_id` FOREIGN KEY \(`replacement_id`\) REFERENCES `replacements` \(`id`\) ON DELETE RESTRICT ON UPDATE RESTRICT,\n/u,
      "\n"
    )
  };
  await createInitialSchemaTable(context, preReplacementTable);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await dropInitialSchemaTable(context, table);
}
