import type { MigrationContext } from "./migration-helpers.js";

// Extends the shared PAYMENT_STATUS_VALUES enum on both payments.status and
// orders.payment_status with "partially_refunded" — same ALTER-both-tables
// shape 032-add-payment-cancelled-status.ts would have used had "cancelled"
// not already existed on orders.payment_status at that point. See
// RefundFinalizationService for who actually writes this value.
export async function up({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  await sequelize.query(
    "ALTER TABLE `payments` MODIFY COLUMN `status` ENUM('pending','paid','failed','refunded','cancelled','partially_refunded') NOT NULL DEFAULT 'pending'"
  );
  await sequelize.query(
    "ALTER TABLE `orders` MODIFY COLUMN `payment_status` ENUM('pending','paid','failed','refunded','cancelled','partially_refunded') NOT NULL DEFAULT 'pending'"
  );
}

export async function down({ context: { sequelize } }: { context: MigrationContext }): Promise<void> {
  const [paymentRows] = (await sequelize.query("SELECT COUNT(*) AS cnt FROM `payments` WHERE `status` = 'partially_refunded'")) as [Array<{ cnt: number }>, unknown];
  const [orderRows] = (await sequelize.query("SELECT COUNT(*) AS cnt FROM `orders` WHERE `payment_status` = 'partially_refunded'")) as [Array<{ cnt: number }>, unknown];
  const paymentCount = paymentRows[0]?.cnt ?? 0;
  const orderCount = orderRows[0]?.cnt ?? 0;
  if (paymentCount > 0 || orderCount > 0) {
    throw new Error(
      `Migration 037 rollback refused: ${paymentCount} payment(s) and ${orderCount} order(s) are in the 'partially_refunded' state. ` +
        "Manual intervention required before reverting this migration."
    );
  }

  await sequelize.query("ALTER TABLE `payments` MODIFY COLUMN `status` ENUM('pending','paid','failed','refunded','cancelled') NOT NULL DEFAULT 'pending'");
  await sequelize.query("ALTER TABLE `orders` MODIFY COLUMN `payment_status` ENUM('pending','paid','failed','refunded','cancelled') NOT NULL DEFAULT 'pending'");
}
