import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive item-level quantity for ReturnRequest. Originally return_requests
// was whole-line-only (one row per OrderItem, no quantity column) — a return
// implicitly meant "the entire line". This migration adds `quantity` and
// backfills every existing row to its OrderItem's full purchased quantity,
// preserving that original whole-line meaning for pre-existing data before
// the column becomes NOT NULL. New rows created after this migration may
// request any quantity from 1 up to the OrderItem's purchased quantity minus
// whatever is already returned/open (enforced in ReturnService, not here).
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'return_requests' AND column_name = 'quantity'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query("ALTER TABLE `return_requests` ADD COLUMN `quantity` INT UNSIGNED NULL AFTER `order_item_id`;");

  await context.sequelize.query(`
    UPDATE \`return_requests\` r
      JOIN \`order_items\` oi ON oi.\`id\` = r.\`order_item_id\`
      SET r.\`quantity\` = oi.\`quantity\`
      WHERE r.\`quantity\` IS NULL;
  `);

  await context.sequelize.query(`
    ALTER TABLE \`return_requests\`
      MODIFY COLUMN \`quantity\` INT UNSIGNED NOT NULL,
      ADD CONSTRAINT \`chk_return_requests_quantity_positive\` CHECK (\`quantity\` > 0);
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`return_requests\`
      DROP CONSTRAINT \`chk_return_requests_quantity_positive\`,
      DROP COLUMN \`quantity\`;
  `);
}
