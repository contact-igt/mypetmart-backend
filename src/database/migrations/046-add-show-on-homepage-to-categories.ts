import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, non-nullable with a safe default: flags a Category as eligible
// for a future curated Homepage display, independent of `active` (which
// controls Storefront/Shop availability). Every historical Category defaults
// to false (not shown) until an Admin opts it in.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'categories' AND column_name = 'show_on_homepage'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`categories\`
      ADD COLUMN \`show_on_homepage\` TINYINT(1) NOT NULL DEFAULT 0 AFTER \`display_order\`;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`categories\`
      DROP COLUMN \`show_on_homepage\`;
  `);
}
