import type { QueryInterface, Sequelize } from "sequelize";

import type { SchemaTableDefinition } from "./schema-definition.js";

export type MigrationContext = {
  queryInterface: QueryInterface;
  sequelize: Sequelize;
};

export type MigrationArguments = {
  context: MigrationContext;
};

export async function createInitialSchemaTable(context: MigrationContext, definition: SchemaTableDefinition): Promise<void> {
  await context.queryInterface.sequelize.query(definition.createSql);
}

export async function dropInitialSchemaTable(context: MigrationContext, definition: SchemaTableDefinition): Promise<void> {
  await context.queryInterface.dropTable(definition.tableName);
}
