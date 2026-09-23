import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<{ columnName: string }>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'announcement_bar_items' AND column_name = 'link_label'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) return;
  await context.sequelize.query("ALTER TABLE `announcement_bar_items` ADD COLUMN `link_label` VARCHAR(60) NULL AFTER `link_url`");
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query("ALTER TABLE `announcement_bar_items` DROP COLUMN `link_label`");
}
