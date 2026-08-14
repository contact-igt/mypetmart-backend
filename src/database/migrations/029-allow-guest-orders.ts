import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { isNullable: string };

// Guest checkout: orders.user_id must become nullable so a guest Order (no
// authenticated customer) can be persisted. The `fk_orders_user_id` FK
// constraint and its ON DELETE RESTRICT / ON UPDATE RESTRICT rules are left
// untouched — only the column's NOT NULL constraint changes. This mirrors the
// existing carts.user_id nullable pattern used for guest Carts.
export async function up({ context }: MigrationArguments): Promise<void> {
  const [column] = await context.sequelize.query<ColumnRow>(
    "SELECT is_nullable AS isNullable FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'user_id'",
    { type: QueryTypes.SELECT }
  );

  if (!column) {
    throw new Error("Migration 029 could not find orders.user_id.");
  }
  if (column.isNullable === "YES") {
    return;
  }

  await context.sequelize.query("ALTER TABLE `orders` MODIFY COLUMN `user_id` INT UNSIGNED NULL;");
}

export async function down({ context }: MigrationArguments): Promise<void> {
  const [row] = await context.sequelize.query<{ guestOrderCount: number }>(
    "SELECT COUNT(*) AS guestOrderCount FROM `orders` WHERE `user_id` IS NULL",
    { type: QueryTypes.SELECT }
  );
  const guestOrderCount = row?.guestOrderCount ?? 0;

  if (guestOrderCount > 0) {
    throw new Error(
      `Migration 029 cannot be reversed: ${guestOrderCount} guest Order(s) with NULL user_id exist. Reassign or remove them before rolling back.`
    );
  }

  await context.sequelize.query("ALTER TABLE `orders` MODIFY COLUMN `user_id` INT UNSIGNED NOT NULL;");
}
