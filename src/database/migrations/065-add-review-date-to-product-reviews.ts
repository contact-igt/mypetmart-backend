import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, nullable — Customer Review Enhancement Stage 1. An optional,
// admin-controlled public-facing review date. review_date is DATE (not
// DATETIME): it is a calendar date with no time component, and DATE avoids
// the timezone-shift risk DATETIME introduces when the value is read back and
// displayed (same reasoning as 058-add-shipment-eta-fields.ts's estimated_*
// fields). NULL for every review that predates this column and every
// customer-authored review — never backfilled: NULL carries the semantic
// meaning "no custom review date", and the storefront resolves the public
// date as `review_date ?? created_at`. created_at is untouched and remains
// the real system/audit timestamp.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'product_reviews' AND column_name = 'review_date'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`product_reviews\`
      ADD COLUMN \`review_date\` DATE NULL;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`product_reviews\`
      DROP COLUMN \`review_date\`;
  `);
}
