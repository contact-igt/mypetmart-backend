import type { MigrationArguments } from "./migration-helpers.js";
import { INITIAL_SCHEMA_TABLES } from "./schema-definition.js";

export async function up({ context }: MigrationArguments): Promise<void> {
  for (const table of INITIAL_SCHEMA_TABLES) {
    try {
      await context.sequelize.query(
        `ALTER TABLE \`${table.tableName}\` MODIFY COLUMN \`id\` INT UNSIGNED NOT NULL`
      );
    } catch (e) {
      // Ignore if table does not exist or column doesn't match
      console.warn(`Could not remove AUTO_INCREMENT on ${table.tableName}:`, e instanceof Error ? e.message : e);
    }
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  for (const table of INITIAL_SCHEMA_TABLES) {
    try {
      await context.sequelize.query(
        `ALTER TABLE \`${table.tableName}\` MODIFY COLUMN \`id\` INT UNSIGNED NOT NULL AUTO_INCREMENT`
      );
    } catch (e) {
      console.warn(`Could not restore AUTO_INCREMENT on ${table.tableName}:`, e instanceof Error ? e.message : e);
    }
  }
}
