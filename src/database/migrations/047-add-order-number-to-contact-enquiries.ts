import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, nullable: a customer-supplied Order reference typed into the
// Contact form for an "Order Question" enquiry. Not an FK to `orders` — the
// Contact form is guest-accessible and this value is never validated against
// real Order ownership in V1 (see docs/DECISIONS.md-equivalent reasoning in
// the Contact Enquiry implementation task). VARCHAR(50) matches
// `orders.order_number`'s own column length for consistency.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'contact_enquiries' AND column_name = 'order_number'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`contact_enquiries\`
      ADD COLUMN \`order_number\` VARCHAR(50) NULL AFTER \`subject\`;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`contact_enquiries\`
      DROP COLUMN \`order_number\`;
  `);
}
