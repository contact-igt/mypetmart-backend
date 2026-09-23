import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

const columns = [
  { name: "cta_mode", sql: "`cta_mode` ENUM('email_signup', 'navigation') NOT NULL DEFAULT 'email_signup' AFTER `offer_label`" },
  { name: "display_delay_ms", sql: "`display_delay_ms` INT UNSIGNED NOT NULL DEFAULT 1200 AFTER `cta_url`" },
  { name: "dismissal_cooldown_days", sql: "`dismissal_cooldown_days` INT UNSIGNED NOT NULL DEFAULT 7 AFTER `display_delay_ms`" }
] as const;

export async function up({ context }: MigrationArguments): Promise<void> {
  for (const column of columns) {
    const existing = await context.sequelize.query<{ columnName: string }>(
      "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'welcome_popups' AND column_name = ?",
      { replacements: [column.name], type: QueryTypes.SELECT }
    );
    if (existing.length === 0) await context.sequelize.query(`ALTER TABLE \`welcome_popups\` ADD COLUMN ${column.sql}`);
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  for (const column of [...columns].reverse()) {
    const existing = await context.sequelize.query<{ columnName: string }>(
      "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'welcome_popups' AND column_name = ?",
      { replacements: [column.name], type: QueryTypes.SELECT }
    );
    if (existing.length > 0) await context.sequelize.query(`ALTER TABLE \`welcome_popups\` DROP COLUMN \`${column.name}\``);
  }
}
