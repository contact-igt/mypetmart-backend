import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<{ columnName: string }>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'display_order'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) return;
  await context.sequelize.query("ALTER TABLE `products` ADD COLUMN `display_order` INT NOT NULL DEFAULT 1000, ADD CONSTRAINT `chk_products_display_order_nonnegative` CHECK (`display_order` >= 0)");
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query("ALTER TABLE `products` DROP CHECK `chk_products_display_order_nonnegative`, DROP COLUMN `display_order`");
}
