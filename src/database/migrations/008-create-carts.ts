import { createInitialSchemaTable, dropInitialSchemaTable, type MigrationArguments } from "./migration-helpers.js";
import { getInitialSchemaTable } from "./schema-definition.js";

const table = getInitialSchemaTable("carts");

export async function up({ context }: MigrationArguments): Promise<void> {
  await createInitialSchemaTable(context, table);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await dropInitialSchemaTable(context, table);
}
