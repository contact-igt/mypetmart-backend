import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };
type ConstraintRow = { constraintName: string };

// coupons (074) is created after carts (008), so the FK to it can never live
// inside 008's own CREATE TABLE text (see the comment on the carts entry in
// schema-definition.ts) — it is added here instead, once coupons is
// guaranteed to exist. The column + index change is applied idempotently
// because a fresh install already gets both from 008's current (updated)
// definition; only a database that ran the old 008 shape before this
// migration existed needs the ALTER.
export async function up({ context }: MigrationArguments): Promise<void> {
  const columns = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'carts' AND column_name = 'coupon_id'",
    { type: QueryTypes.SELECT }
  );

  if (columns.length === 0) {
    await context.sequelize.query(`
      ALTER TABLE \`carts\`
        ADD COLUMN \`coupon_id\` INT UNSIGNED NULL AFTER \`status\`,
        ADD KEY \`carts_coupon_id_idx\` (\`coupon_id\`);
    `);
  }

  const constraints = await context.sequelize.query<ConstraintRow>(
    "SELECT constraint_name AS constraintName FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'carts' AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'fk_carts_coupon_id'",
    { type: QueryTypes.SELECT }
  );

  if (constraints.length === 0) {
    await context.sequelize.query(`
      ALTER TABLE \`carts\`
        ADD CONSTRAINT \`fk_carts_coupon_id\` FOREIGN KEY (\`coupon_id\`) REFERENCES \`coupons\` (\`id\`) ON DELETE SET NULL ON UPDATE RESTRICT;
    `);
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`carts\`
      DROP FOREIGN KEY \`fk_carts_coupon_id\`,
      DROP KEY \`carts_coupon_id_idx\`,
      DROP COLUMN \`coupon_id\`;
  `);
}
