import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

// Additive migration: the Global Pay Online Discount snapshot.
//
//   orders.online_payment_discount_type_snapshot / _value_snapshot — the
//     global configuration in effect when the Order was created ("percentage"
//     value in basis points, "fixed" value in paise). NULL when no online
//     discount applied (COD, legacy clients, discount disabled).
//   orders.online_payment_discount_amount_paise — the discount actually
//     applied. Separate from coupon_discount_amount_paise: the two are never
//     merged.
//   order_items.online_payment_discount_allocated_paise — each line's share of
//     that amount, for partial refunds. Always sums exactly to the Order's
//     online_payment_discount_amount_paise.
//
// Every existing row defaults to 0 / NULL, so historical Orders are unchanged.
// Idempotent: each ALTER is skipped when its column already exists.

async function columnExists(context: MigrationArguments["context"], table: string, column: string): Promise<boolean> {
  const rows = await context.sequelize.query<{ columnName: string }>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column",
    { type: QueryTypes.SELECT, replacements: { table, column } }
  );
  return rows.length > 0;
}

export async function up({ context }: MigrationArguments): Promise<void> {
  if (!(await columnExists(context, "orders", "online_payment_discount_amount_paise"))) {
    await context.sequelize.query(`
      ALTER TABLE \`orders\`
        ADD COLUMN \`online_payment_discount_type_snapshot\` ENUM('percentage','fixed') NULL AFTER \`coupon_discount_amount_paise\`,
        ADD COLUMN \`online_payment_discount_value_snapshot\` INT UNSIGNED NULL AFTER \`online_payment_discount_type_snapshot\`,
        ADD COLUMN \`online_payment_discount_amount_paise\` INT UNSIGNED NOT NULL DEFAULT 0 AFTER \`online_payment_discount_value_snapshot\`;
    `);
  }
  if (!(await columnExists(context, "order_items", "online_payment_discount_allocated_paise"))) {
    await context.sequelize.query(`
      ALTER TABLE \`order_items\`
        ADD COLUMN \`online_payment_discount_allocated_paise\` INT UNSIGNED NOT NULL DEFAULT 0 AFTER \`discount_allocated_paise\`,
        ADD CONSTRAINT \`chk_order_items_online_discount_allocated_nonnegative\` CHECK (\`online_payment_discount_allocated_paise\` >= 0);
    `);
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`order_items\`
      DROP CONSTRAINT \`chk_order_items_online_discount_allocated_nonnegative\`,
      DROP COLUMN \`online_payment_discount_allocated_paise\`;
  `);
  await context.sequelize.query(`
    ALTER TABLE \`orders\`
      DROP COLUMN \`online_payment_discount_amount_paise\`,
      DROP COLUMN \`online_payment_discount_value_snapshot\`,
      DROP COLUMN \`online_payment_discount_type_snapshot\`;
  `);
}
