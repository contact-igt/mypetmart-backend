import { QueryTypes } from "sequelize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { up as up087, down as down087 } from "../../src/database/migrations/087-add-bridge-columns-to-breeze-checkout-sessions.js";
import { createInitialSchemaTable, dropInitialSchemaTable } from "../../src/database/migrations/migration-helpers.js";
import { getInitialSchemaTable } from "../../src/database/migrations/schema-definition.js";

// The ORIGINAL 085 shape (before the Order Create bridge). Simulates a database
// that already ran 085 and now needs the additive 087.
const LEGACY_085_DDL = `
  CREATE TABLE \`breeze_checkout_sessions\` (
    \`id\` INT UNSIGNED NOT NULL,
    \`public_id\` VARCHAR(64) NOT NULL,
    \`user_id\` INT UNSIGNED NULL,
    \`guest_identity_hash\` VARCHAR(64) NULL,
    \`cart_id\` INT UNSIGNED NOT NULL,
    \`status\` ENUM('created','completed','expired','failed') NOT NULL DEFAULT 'created',
    \`cart_hash\` CHAR(64) NOT NULL,
    \`amount_paise\` INT UNSIGNED NOT NULL,
    \`currency\` CHAR(3) NOT NULL DEFAULT 'INR',
    \`cart_snapshot\` JSON NOT NULL,
    \`breeze_checkout_id\` VARCHAR(190) NULL,
    \`order_id\` INT UNSIGNED NULL,
    \`expires_at\` DATETIME NOT NULL,
    \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`breeze_checkout_sessions_public_id_unique\` (\`public_id\`),
    UNIQUE KEY \`breeze_checkout_sessions_order_id_unique\` (\`order_id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
`;

async function columns(): Promise<string[]> {
  const rows = await sequelize.query<{ c: string }>(
    "SELECT column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'breeze_checkout_sessions'",
    { type: QueryTypes.SELECT }
  );
  return rows.map((row) => row.c);
}

describe("migration 087 — bridge columns on an existing 085 table", () => {
  const table = getInitialSchemaTable("breeze_checkout_sessions");
  const context = { sequelize, queryInterface: sequelize.getQueryInterface() };

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    // Restore the current table definition for any later test.
    await sequelize.query("DROP TABLE IF EXISTS `breeze_checkout_sessions`");
    await createInitialSchemaTable(context, table);
    await disconnectDatabase();
  });

  it("adds the columns, unique keys and FK additively; is idempotent; and rolls back cleanly", async () => {
    await dropInitialSchemaTable(context, table);
    await sequelize.query(LEGACY_085_DDL);
    await sequelize.query("INSERT INTO breeze_checkout_sessions (id, public_id, cart_id, cart_hash, amount_paise, cart_snapshot, expires_at) VALUES (1, 'legacy', 1, REPEAT('a',64), 100, '{}', NOW()) /* FK-free legacy row */").catch(() => undefined);

    expect(await columns()).not.toContain("order_intent");
    await up087({ context });
    const afterUp = await columns();
    for (const column of ["order_intent", "breeze_cart_id", "breeze_order_id", "breeze_txn_id", "payment_id", "processing_status", "last_event_id", "last_error_code"]) {
      expect(afterUp).toContain(column);
    }

    // Idempotent on a table that already has the columns.
    await up087({ context });

    const indexes = await sequelize.query<{ n: string }>("SELECT DISTINCT index_name AS n FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name = 'breeze_checkout_sessions'", { type: QueryTypes.SELECT });
    const names = indexes.map((row) => row.n);
    for (const name of ["breeze_checkout_sessions_breeze_order_id_unique", "breeze_checkout_sessions_breeze_txn_id_unique", "breeze_checkout_sessions_payment_id_unique"]) {
      expect(names).toContain(name);
    }

    await down087({ context });
    expect(await columns()).not.toContain("order_intent");
    // Pre-existing columns are untouched by the rollback.
    expect(await columns()).toEqual(expect.arrayContaining(["public_id", "cart_snapshot", "order_id"]));
  });
});
