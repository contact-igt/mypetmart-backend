import type { MigrationContext } from "./migration-helpers.js";

export async function up({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  await sequelize.query(
    "ALTER TABLE `users` MODIFY COLUMN `role` ENUM('customer','admin','super_admin') NOT NULL DEFAULT 'customer'"
  );
}

export async function down({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  // Refuse rollback if any super_admin row exists to prevent silent data loss.
  const [rows] = await sequelize.query("SELECT COUNT(*) AS cnt FROM `users` WHERE `role` = 'super_admin'") as [Array<{ cnt: number }>, unknown];
  const count = rows[0]?.cnt ?? 0;
  if (count > 0) {
    throw new Error(
      `Migration 019 rollback refused: ${count} super_admin user(s) exist. ` +
      "Remove or reassign all super_admin accounts before reverting this migration."
    );
  }
  await sequelize.query(
    "ALTER TABLE `users` MODIFY COLUMN `role` ENUM('customer','admin') NOT NULL DEFAULT 'customer'"
  );
}
