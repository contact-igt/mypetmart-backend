import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Admin Review Management: lets an Admin manually create a Review with no
// backing User/OrderItem (customer_name is free text in that case), while a
// genuine customer-submitted Review keeps user_id/order_item_id set and
// review_source stays 'customer'. user_id/order_item_id are relaxed to
// nullable here — they were NOT NULL when only the customer flow existed.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'product_reviews' AND column_name = 'review_source'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`product_reviews\`
      MODIFY COLUMN \`user_id\` INT UNSIGNED NULL,
      MODIFY COLUMN \`order_item_id\` INT UNSIGNED NULL,
      ADD COLUMN \`customer_name\` VARCHAR(120) NULL AFTER \`verified_purchase\`,
      ADD COLUMN \`review_source\` ENUM('customer', 'admin') NOT NULL DEFAULT 'customer' AFTER \`customer_name\`;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`product_reviews\`
      DROP COLUMN \`review_source\`,
      DROP COLUMN \`customer_name\`,
      MODIFY COLUMN \`order_item_id\` INT UNSIGNED NOT NULL,
      MODIFY COLUMN \`user_id\` INT UNSIGNED NOT NULL;
  `);
}
