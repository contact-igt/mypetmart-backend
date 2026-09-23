import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };
type ConstraintRow = { constraintName: string };

// coupons (074) is created after orders (010), so the FK to it can never
// live inside 010's own CREATE TABLE text (see the comment on the orders
// entry in schema-definition.ts) — it is added here instead, once coupons is
// guaranteed to exist. All six coupon snapshot columns are immutable once an
// Order is created (see order.service.ts createOrder) — nothing outside this
// migration ever ALTERs them after creation.
export async function up({ context }: MigrationArguments): Promise<void> {
  const columns = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'coupon_id'",
    { type: QueryTypes.SELECT }
  );

  if (columns.length === 0) {
    await context.sequelize.query(`
      ALTER TABLE \`orders\`
        ADD COLUMN \`coupon_id\` INT UNSIGNED NULL AFTER \`total\`,
        ADD COLUMN \`coupon_code_snapshot\` VARCHAR(40) NULL AFTER \`coupon_id\`,
        ADD COLUMN \`coupon_discount_type_snapshot\` ENUM('percentage','fixed') NULL AFTER \`coupon_code_snapshot\`,
        ADD COLUMN \`coupon_discount_value_snapshot\` INT UNSIGNED NULL AFTER \`coupon_discount_type_snapshot\`,
        ADD COLUMN \`coupon_eligible_merchandise_paise\` INT UNSIGNED NULL AFTER \`coupon_discount_value_snapshot\`,
        ADD COLUMN \`coupon_discount_amount_paise\` INT UNSIGNED NOT NULL DEFAULT 0 AFTER \`coupon_eligible_merchandise_paise\`,
        ADD KEY \`orders_coupon_id_idx\` (\`coupon_id\`);
    `);
  }

  const constraints = await context.sequelize.query<ConstraintRow>(
    "SELECT constraint_name AS constraintName FROM information_schema.table_constraints WHERE table_schema = DATABASE() AND table_name = 'orders' AND constraint_type = 'FOREIGN KEY' AND constraint_name = 'fk_orders_coupon_id'",
    { type: QueryTypes.SELECT }
  );

  if (constraints.length === 0) {
    await context.sequelize.query(`
      ALTER TABLE \`orders\`
        ADD CONSTRAINT \`fk_orders_coupon_id\` FOREIGN KEY (\`coupon_id\`) REFERENCES \`coupons\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT;
    `);
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`orders\`
      DROP FOREIGN KEY \`fk_orders_coupon_id\`,
      DROP KEY \`orders_coupon_id_idx\`,
      DROP COLUMN \`coupon_discount_amount_paise\`,
      DROP COLUMN \`coupon_eligible_merchandise_paise\`,
      DROP COLUMN \`coupon_discount_value_snapshot\`,
      DROP COLUMN \`coupon_discount_type_snapshot\`,
      DROP COLUMN \`coupon_code_snapshot\`,
      DROP COLUMN \`coupon_id\`;
  `);
}
