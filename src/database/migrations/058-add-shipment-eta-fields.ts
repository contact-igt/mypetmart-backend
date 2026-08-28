import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, nullable — Phase 2A.2. delivery_tat and the estimated-delivery
// window are captured from the courier candidate actually booked (iThink's
// Rate API, live-verified for the configured account); NULL for every
// shipment created before this field existed, and never backfilled — no
// courier-selection data exists to derive one for those rows. estimated_*
// are DATE (not DATETIME) — iThink's edd_date is a calendar date with no
// time component, and DATE avoids the timezone-shift risk DATETIME would
// introduce when the date is later read back and displayed.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'shipments' AND column_name IN ('delivery_tat', 'estimated_delivery_min_date', 'estimated_delivery_max_date')",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`shipments\`
      ADD COLUMN \`delivery_tat\` SMALLINT UNSIGNED NULL AFTER \`shipping_charge\`,
      ADD COLUMN \`estimated_delivery_min_date\` DATE NULL AFTER \`delivery_tat\`,
      ADD COLUMN \`estimated_delivery_max_date\` DATE NULL AFTER \`estimated_delivery_min_date\`;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`shipments\`
      DROP COLUMN \`delivery_tat\`,
      DROP COLUMN \`estimated_delivery_min_date\`,
      DROP COLUMN \`estimated_delivery_max_date\`;
  `);
}
