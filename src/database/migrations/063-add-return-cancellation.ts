import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

const PREVIOUS_STATUS_VALUES = ["requested", "approved", "rejected", "resolved"];
const CURRENT_STATUS_VALUES = [...PREVIOUS_STATUS_VALUES, "cancelled"];

function enumList(values: string[]): string {
  return values.map((value) => `'${value}'`).join(",");
}

export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'return_requests' AND column_name = 'cancelled_at'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) return;

  await context.sequelize.query(`
    ALTER TABLE \`return_requests\`
      MODIFY COLUMN \`status\` ENUM(${enumList(CURRENT_STATUS_VALUES)}) NOT NULL DEFAULT 'requested',
      ADD COLUMN \`cancelled_at\` DATETIME NULL AFTER \`resolved_at\`,
      ADD COLUMN \`cancellation_reason\` TEXT NULL AFTER \`cancelled_at\`,
      ADD COLUMN \`cancelled_by_user_id\` INT UNSIGNED NULL AFTER \`cancellation_reason\`,
      ADD COLUMN \`cancellation_source\` ENUM('customer','admin') NULL AFTER \`cancelled_by_user_id\`,
      ADD KEY \`return_requests_cancelled_by_user_id_idx\` (\`cancelled_by_user_id\`),
      ADD CONSTRAINT \`fk_return_requests_cancelled_by_user_id\` FOREIGN KEY (\`cancelled_by_user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  const [rows] = await context.sequelize.query<{ count: number | string }>(
    "SELECT COUNT(*) AS count FROM `return_requests` WHERE `status` = 'cancelled'",
    { type: QueryTypes.SELECT }
  );
  if (Number(rows?.count ?? 0) > 0) {
    throw new Error("Migration 063 rollback refused: return request row(s) use the cancelled status.");
  }

  await context.sequelize.query(`
    ALTER TABLE \`return_requests\`
      DROP FOREIGN KEY \`fk_return_requests_cancelled_by_user_id\`,
      DROP KEY \`return_requests_cancelled_by_user_id_idx\`,
      DROP COLUMN \`cancellation_source\`,
      DROP COLUMN \`cancelled_by_user_id\`,
      DROP COLUMN \`cancellation_reason\`,
      DROP COLUMN \`cancelled_at\`,
      MODIFY COLUMN \`status\` ENUM(${enumList(PREVIOUS_STATUS_VALUES)}) NOT NULL DEFAULT 'requested';
  `);
}
