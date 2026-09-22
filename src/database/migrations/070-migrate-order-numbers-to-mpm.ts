import { QueryTypes } from "sequelize";

import type { MigrationArguments } from "./migration-helpers.js";

const ORDER_NUMBER_SEQUENCE = "order_numbers";
const FIRST_ORDER_NUMBER = 2430;

type NextOrderNumberRow = { nextValue: number | string | null };

/** Starts the independent MPM sequence without changing historical order references. */
export async function up({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.transaction(async (transaction) => {
    const [row] = await context.sequelize.query<NextOrderNumberRow>(
      "SELECT COALESCE(MAX(CAST(SUBSTRING(`order_number`, 5) AS UNSIGNED)), ?) + 1 AS `nextValue` FROM `orders` WHERE `order_number` REGEXP '^MPM-[0-9]+$' FOR UPDATE",
      { replacements: [FIRST_ORDER_NUMBER - 1], type: QueryTypes.SELECT, transaction }
    );
    const nextValue = Number(row?.nextValue ?? FIRST_ORDER_NUMBER);

    await context.sequelize.query(
      "INSERT INTO `id_sequences` (`sequence_name`, `next_value`, `updated_at`) VALUES (?, ?, NOW()) ON DUPLICATE KEY UPDATE `next_value` = GREATEST(`next_value`, VALUES(`next_value`)), `updated_at` = VALUES(`updated_at`)",
      { replacements: [ORDER_NUMBER_SEQUENCE, nextValue], type: QueryTypes.INSERT, transaction }
    );
  });
}

// Sequence values may already have been issued to real orders, so rollback
// must not lower or remove the sequence row.
export async function down(): Promise<void> {}
