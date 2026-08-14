import type { MigrationContext } from "./migration-helpers.js";

export async function up({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  await sequelize.query(
    "ALTER TABLE `payments` MODIFY COLUMN `status` ENUM('pending','paid','failed','refunded','cancelled') NOT NULL DEFAULT 'pending'"
  );
}

export async function down({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  // Refuse rollback if any cancelled payments exist.
  const [rows] = await sequelize.query("SELECT COUNT(*) AS cnt FROM `payments` WHERE `status` = 'cancelled'") as [Array<{ cnt: number }>, unknown];
  const count = rows[0]?.cnt ?? 0;
  if (count > 0) {
    throw new Error(
      `Migration 032 rollback refused: ${count} cancelled payment(s) exist. ` +
      "Manual intervention required before reverting this migration."
    );
  }
  await sequelize.query(
    "ALTER TABLE `payments` MODIFY COLUMN `status` ENUM('pending','paid','failed','refunded') NOT NULL DEFAULT 'pending'"
  );
}
