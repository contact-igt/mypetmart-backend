import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, nullable exception marker. Set only by PaymentFinalizationService
// when a verified-successful PayU payment cannot confirm the Order — either
// stock ran out between Order creation and finalization (the two-Orders-
// race-for-the-last-unit case: 'inventory_unavailable'), or the Order's own
// status was no longer eligible for confirmation, e.g. it was independently
// cancelled while a Payment attempt was still in flight at PayU
// ('order_not_confirmable'). PayU genuinely captured the money in both
// cases, so Payment.status/Order.payment_status still become "paid" — this
// column is the only signal that the Order is NOT actually
// confirmed/fulfillable and needs manual review (restock, refund, or
// cancellation reconciliation; all future work). NULL for every ordinary Order.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'commerce_exception'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`orders\`
      ADD COLUMN \`commerce_exception\` ENUM('inventory_unavailable', 'order_not_confirmable') NULL AFTER \`fulfilment_status\`,
      ADD KEY \`orders_commerce_exception_idx\` (\`commerce_exception\`);
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  const [row] = await context.sequelize.query<{ exceptionCount: number }>(
    "SELECT COUNT(*) AS exceptionCount FROM `orders` WHERE `commerce_exception` IS NOT NULL",
    { type: QueryTypes.SELECT }
  );
  const exceptionCount = row?.exceptionCount ?? 0;
  if (exceptionCount > 0) {
    throw new Error(
      `Migration 034 cannot be reversed: ${exceptionCount} Order(s) are flagged with a commerce exception pending manual review. Resolve them before rolling back this column.`
    );
  }

  await context.sequelize.query(`
    ALTER TABLE \`orders\`
      DROP KEY \`orders_commerce_exception_idx\`,
      DROP COLUMN \`commerce_exception\`;
  `);
}
