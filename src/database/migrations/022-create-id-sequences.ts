import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";
import { INITIAL_SCHEMA_TABLES } from "./schema-definition.js";

export async function up({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    CREATE TABLE IF NOT EXISTS \`id_sequences\` (
      \`sequence_name\` VARCHAR(190) NOT NULL,
      \`next_value\` INT UNSIGNED NOT NULL DEFAULT 1,
      \`updated_at\` DATETIME NOT NULL,
      PRIMARY KEY (\`sequence_name\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
  `);

  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  for (const table of INITIAL_SCHEMA_TABLES) {
    let maxId: number | null = null;
    try {
      const rows = await context.sequelize.query<{ maxId: number | null }>(
        `SELECT MAX(id) AS maxId FROM \`${table.tableName}\``,
        { type: QueryTypes.SELECT }
      );
      if (rows && rows.length > 0 && rows[0]) {
        maxId = rows[0].maxId;
      }
    } catch {
      // Table doesn't exist yet, which is fine
    }

    const nextVal = (maxId ?? 0) + 1;
    await context.sequelize.query(
      "INSERT INTO `id_sequences` (`sequence_name`, `next_value`, `updated_at`) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE `next_value` = VALUES(`next_value`), `updated_at` = VALUES(`updated_at`)",
      { replacements: [table.tableName, nextVal, now] }
    );
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.queryInterface.dropTable("id_sequences");
}
