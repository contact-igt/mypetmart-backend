import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

// Per-line share of the parent Order's coupon_discount_amount_paise —
// allocated proportionally by CouponPricingService.allocateDiscountAcrossLines
// at Order creation time (see order.service.ts). Allocated amounts across an
// Order's items always sum exactly to that Order's coupon_discount_amount_paise,
// which partial refunds and financial reconciliation rely on. Zero (the
// default) for every line on an Order with no coupon, and for every
// coupon-ineligible line on an Order that does have one.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<{ columnName: string }>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'order_items' AND column_name = 'discount_allocated_paise'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) return;
  await context.sequelize.query(
    "ALTER TABLE `order_items` ADD COLUMN `discount_allocated_paise` INT UNSIGNED NOT NULL DEFAULT 0, ADD CONSTRAINT `chk_order_items_discount_allocated_nonnegative` CHECK (`discount_allocated_paise` >= 0)"
  );
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query("ALTER TABLE `order_items` DROP CONSTRAINT `chk_order_items_discount_allocated_nonnegative`, DROP COLUMN `discount_allocated_paise`");
}
