import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

// Additive migration: adds `payment_method_eligibility` to the coupons table.
// All existing rows default to "both" via the column DEFAULT, preserving prior
// behavior identically — a coupon that had no eligibility restriction still
// applies to both PayU and COD. No existing rows are touched.
//
// Enum values: "both" | "payu" | "cod"
//   "both" — eligible for PayU and COD (backward-compatible default)
//   "payu" — eligible for online prepaid payment (PayU) only
//   "cod"  — eligible for Cash on Delivery only
//
// This migration is idempotent (skips the ALTER TABLE if the column already
// exists) so it is safe to rerun in development and testing.

export async function up({ context }: MigrationArguments): Promise<void> {
  const columns = await context.sequelize.query<{ columnName: string }>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'coupons' AND column_name = 'payment_method_eligibility'",
    { type: QueryTypes.SELECT }
  );
  if (columns.length > 0) return;

  await context.sequelize.query(`
    ALTER TABLE \`coupons\`
      ADD COLUMN \`payment_method_eligibility\` ENUM('both', 'payu', 'cod') NOT NULL DEFAULT 'both'
        AFTER \`first_order_only\`;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`coupons\`
      DROP COLUMN \`payment_method_eligibility\`;
  `);
}
