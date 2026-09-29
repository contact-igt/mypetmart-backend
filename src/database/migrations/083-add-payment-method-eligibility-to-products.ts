import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

// Additive migration: product-level payment-method availability.
//
//   products.payment_method_eligibility — which methods the Product may be
//     bought with: "both" (default — every existing Product keeps today's
//     behaviour), "payu" (Pay Online only) or "cod" (Cash on Delivery only).
//
//   order_items.product_payment_method_eligibility_snapshot — the Product's
//     eligibility frozen at Order creation. Payment entry points validate the
//     requested method against this snapshot, so an admin editing a Product
//     later never changes the payment contract of an existing pending Order.
//     Historical rows default to "both", which is exactly how they were sold.
//
// Idempotent: each ALTER is skipped when its column already exists.

async function columnExists(context: MigrationArguments["context"], table: string, column: string): Promise<boolean> {
  const rows = await context.sequelize.query<{ columnName: string }>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = :table AND column_name = :column",
    { type: QueryTypes.SELECT, replacements: { table, column } }
  );
  return rows.length > 0;
}

export async function up({ context }: MigrationArguments): Promise<void> {
  if (!(await columnExists(context, "products", "payment_method_eligibility"))) {
    await context.sequelize.query(`
      ALTER TABLE \`products\`
        ADD COLUMN \`payment_method_eligibility\` ENUM('both', 'payu', 'cod') NOT NULL DEFAULT 'both'
          AFTER \`featured\`;
    `);
  }
  if (!(await columnExists(context, "order_items", "product_payment_method_eligibility_snapshot"))) {
    await context.sequelize.query(`
      ALTER TABLE \`order_items\`
        ADD COLUMN \`product_payment_method_eligibility_snapshot\` ENUM('both', 'payu', 'cod') NOT NULL DEFAULT 'both'
          AFTER \`discount_allocated_paise\`;
    `);
  }
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query("ALTER TABLE `order_items` DROP COLUMN `product_payment_method_eligibility_snapshot`;");
  await context.sequelize.query("ALTER TABLE `products` DROP COLUMN `payment_method_eligibility`;");
}
