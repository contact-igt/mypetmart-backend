import { readFileSync } from "node:fs";

import type { Sequelize } from "sequelize";
import { describe, expect, it, vi } from "vitest";

import {
  assertDownAllAllowed,
  assertUniqueMigrationNames,
  expectedBusinessTableNames,
  MIGRATION_FILE_NAMES,
  MigrationLockError,
  UnsafeMigrationResetError,
  withMigrationLock
} from "../../src/database/migrations/migrator.js";
import { INITIAL_SCHEMA_TABLES } from "../../src/database/migrations/schema-definition.js";
import { databaseConfig } from "../../src/config/database.config.js";

describe("Stage 5 migration runner", () => {
  it("discovers the initial schema migrations in numeric order", () => {
    expect(INITIAL_SCHEMA_TABLES).toHaveLength(21);
    expect(expectedBusinessTableNames()).toEqual([
      "users",
      "auth_sessions",
      "addresses",
      "categories",
      "products",
      "product_variants",
      "product_images",
      "carts",
      "cart_items",
      "orders",
      "order_items",
      "order_notes",
      "payments",
      "shipments",
      "return_requests",
      "return_notes",
      "contact_enquiries",
      "store_settings",
      "auth_challenges",
      "password_reset_tokens",
      "wishlists"
    ]);
    expect(MIGRATION_FILE_NAMES).toEqual([...MIGRATION_FILE_NAMES].sort());
  });

  it("rejects duplicate migration names", () => {
    expect(() => assertUniqueMigrationNames(["001-create-users.ts", "001-create-users.ts"])).toThrow(/Duplicate migration names/u);
  });

  it("blocks down-all in production and without local confirmation", () => {
    expect(() => assertDownAllAllowed({ environment: "production", databaseName: databaseConfig.database, confirmed: true })).toThrow(UnsafeMigrationResetError);
    expect(() => assertDownAllAllowed({ environment: "development", databaseName: databaseConfig.database, confirmed: false })).toThrow(UnsafeMigrationResetError);
    expect(() => assertDownAllAllowed({ environment: "development", databaseName: "not_mypetmart", confirmed: true })).toThrow(UnsafeMigrationResetError);
    expect(() => assertDownAllAllowed({ environment: "development", databaseName: databaseConfig.database, confirmed: true })).not.toThrow();
  });

  it("fails when the advisory lock cannot be acquired", async () => {
    const query = vi.fn().mockResolvedValueOnce([{ lock_acquired: 0 }]);
    await expect(withMigrationLock({ query } as unknown as Sequelize, () => Promise.resolve(undefined))).rejects.toThrow(MigrationLockError);
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("surfaces advisory lock release failures after successful work", async () => {
    const query = vi.fn().mockResolvedValueOnce([{ lock_acquired: 1 }]).mockResolvedValueOnce([{ lock_released: 0 }]);
    await expect(withMigrationLock({ query } as unknown as Sequelize, () => Promise.resolve("done"))).rejects.toThrow(MigrationLockError);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("does not wire migrations or sync into application startup", () => {
    const databaseIndex = readFileSync("src/database/index.ts", "utf8");
    const app = readFileSync("src/app.ts", "utf8");
    const server = readFileSync("src/server.ts", "utf8");
    const startupSource = `${databaseIndex}\n${app}\n${server}`;

    expect(startupSource).not.toMatch(/\.sync\s*\(/u);
    expect(startupSource).not.toMatch(/createMigrator|db:migrate|migrator\.up|\.up\s*\(/u);
  });
});

