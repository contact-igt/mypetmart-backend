import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, nullable: three Admin-entered informational text blocks — how to
// use, care instructions, and safety/important information. Plain TEXT (no
// rich-text/HTML architecture — see product-detail rendering, which uses the
// same whitespace-pre-line convention as Description). NULL for every
// historical Product; Storefront and Admin both treat a missing value as
// "no content for this section", not an error.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = 'how_to_use'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`products\`
      ADD COLUMN \`how_to_use\` TEXT NULL AFTER \`height_cm\`,
      ADD COLUMN \`care_instructions\` TEXT NULL AFTER \`how_to_use\`,
      ADD COLUMN \`safety_info\` TEXT NULL AFTER \`care_instructions\`;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`products\`
      DROP COLUMN \`how_to_use\`,
      DROP COLUMN \`care_instructions\`,
      DROP COLUMN \`safety_info\`;
  `);
}
