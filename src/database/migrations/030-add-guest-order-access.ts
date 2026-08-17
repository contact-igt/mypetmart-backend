import { QueryTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

type ColumnRow = { columnName: string };

// Guest Order safety: two additive, nullable columns on `orders`.
//
// `guest_identity_hash` mirrors `carts.guest_token_hash` exactly (same
// SHA-256 hex hash of the guest's opaque cart-cookie token, via
// TokenService.hashToken) and is the idempotency key order.service.ts uses
// to find an existing pending guest Order — concurrency safety comes from
// locking the guest's Cart row (the same primitive the customer path already
// uses via the User row), not a DB unique constraint, since a guest may
// legitimately place more than one Order over time once earlier ones leave
// `pending` status. Only ever set for guest Orders (user_id IS NULL).
//
// `guest_access_token_hash` is the SHA-256 hash of a separate, single-purpose
// opaque recovery token returned to the guest once at creation (and rotated
// on an idempotent repeat-create) — never the guest cart token, so a leaked
// order-recovery link can never be used to take over the guest's Cart. NULL
// for customer Orders. Unique when present, exactly like
// `carts.guest_token_hash`, so a hash collision can never resolve two Orders.
export async function up({ context }: MigrationArguments): Promise<void> {
  const existing = await context.sequelize.query<ColumnRow>(
    "SELECT column_name AS columnName FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'orders' AND column_name IN ('guest_identity_hash', 'guest_access_token_hash')",
    { type: QueryTypes.SELECT }
  );

  if (existing.length === 2) {
    return;
  }
  if (existing.length !== 0) {
    throw new Error("Migration 030 found a partial guest-order-access schema on orders.");
  }

  await context.sequelize.query(`
    ALTER TABLE \`orders\`
      ADD COLUMN \`guest_identity_hash\` VARCHAR(255) NULL AFTER \`user_id\`,
      ADD COLUMN \`guest_access_token_hash\` VARCHAR(255) NULL AFTER \`guest_identity_hash\`,
      ADD UNIQUE KEY \`orders_guest_access_token_hash_unique\` (\`guest_access_token_hash\`),
      ADD KEY \`orders_guest_identity_status_idx\` (\`guest_identity_hash\`, \`status\`);
  `);
}

export async function down({ context }: MigrationArguments): Promise<void> {
  const [row] = await context.sequelize.query<{ guestTokenCount: number }>(
    "SELECT COUNT(*) AS guestTokenCount FROM `orders` WHERE `guest_access_token_hash` IS NOT NULL",
    { type: QueryTypes.SELECT }
  );
  const guestTokenCount = row?.guestTokenCount ?? 0;

  if (guestTokenCount > 0) {
    throw new Error(
      `Migration 030 cannot be reversed: ${guestTokenCount} guest Order(s) with an active recovery token exist. Those Orders would become unrecoverable.`
    );
  }

  await context.sequelize.query(`
    ALTER TABLE \`orders\`
      DROP KEY \`orders_guest_identity_status_idx\`,
      DROP KEY \`orders_guest_access_token_hash_unique\`,
      DROP COLUMN \`guest_access_token_hash\`,
      DROP COLUMN \`guest_identity_hash\`;
  `);
}
