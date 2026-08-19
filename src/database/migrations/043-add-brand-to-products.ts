import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, nullable: the Product's manufacturer/brand name, entered freely
// by Admin (no Brand table/module — see docs/PROJECT_BRIEF.md scope
// exclusions). NULL for every historical Product; storefront and Admin both
// treat a missing brand as "no brand", not an error.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'brand'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`products\`
      ADD COLUMN \`brand\` VARCHAR(120) NULL AFTER \`sku\`;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`products\`
      DROP COLUMN \`brand\`;
  `);
}
