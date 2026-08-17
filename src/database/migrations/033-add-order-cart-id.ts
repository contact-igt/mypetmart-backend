import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Additive, nullable FK: the exact Cart an Order was created from, captured
// once at Order creation time (OrderService.createOrder). Needed so payment
// finalization can identify "the Cart that produced this Order" precisely —
// re-deriving "the caller's current active Cart" at finalization time is
// unsafe, since Order creation never touches the Cart and its contents can
// legitimately drift (more items added, etc.) between Order creation and
// payment finalizing. NULL for Orders created before this migration; those
// fall back to the legacy identity-based lookup in CartService at
// finalization time. ON DELETE SET NULL rather than RESTRICT/CASCADE: no
// code path deletes Carts today, but an Order must never become undeletable
// or lose its own identity just because a future Cart-pruning job removes an
// old, already-finalized Cart row.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name = 'cart_id'",
    { type: QueryTypes.SELECT }
  );
  if (existing.length > 0) {
    return;
  }

  await context.sequelize.query(`
    ALTER TABLE \`orders\`
      ADD COLUMN \`cart_id\` INT UNSIGNED NULL AFTER \`guest_access_token_hash\`,
      ADD KEY \`orders_cart_id_idx\` (\`cart_id\`),
      ADD CONSTRAINT \`fk_orders_cart_id\` FOREIGN KEY (\`cart_id\`) REFERENCES \`carts\` (\`id\`) ON DELETE SET NULL ON UPDATE RESTRICT;
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.sequelize.query(`
    ALTER TABLE \`orders\`
      DROP FOREIGN KEY \`fk_orders_cart_id\`,
      DROP KEY \`orders_cart_id_idx\`,
      DROP COLUMN \`cart_id\`;
  `);
}
