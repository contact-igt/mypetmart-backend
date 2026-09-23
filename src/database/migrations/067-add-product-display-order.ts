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
  // DROP CHECK is MySQL-only syntax; this MariaDB-hosted test DB requires
  // DROP CONSTRAINT for a CHECK constraint (the pattern already used
  // successfully elsewhere — see 024/026/036's down()). This was a
  // pre-existing bug that only surfaces when a full down({to:0}) rollback
  // reaches this migration; fixed here since it was blocking that path.
  await context.sequelize.query("ALTER TABLE `products` DROP CONSTRAINT `chk_products_display_order_nonnegative`, DROP COLUMN `display_order`");
}
