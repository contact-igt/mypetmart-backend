import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { QueryTypes, type Sequelize } from "sequelize";
import { SequelizeStorage, Umzug, type MigrationMeta } from "umzug";

import { databaseConfig } from "../../config/database.config.js";
import { sequelize } from "../index.js";
import type { MigrationContext } from "./migration-helpers.js";
import { EXPECTED_BUSINESS_TABLE_NAMES, INITIAL_SCHEMA_TABLES } from "./schema-definition.js";

export const MIGRATION_LOCK_NAME = "mypetmart_schema_migrations";
export const MIGRATION_LOCK_TIMEOUT_SECONDS = 10;
// Alter migrations run after all CREATE TABLE migrations and are not tied to a specific table.
const SCHEMA_ALTER_MIGRATION_NAMES = [
  "019-add-super-admin-role.ts",
  "022-create-id-sequences.ts",
  "023-remove-auto-increment.ts",
  "024-add-shipping-dimensions-to-products.ts",
  "025-create-catalog-sku-reservations.ts",
  "026-allow-zero-product-price-cache.ts",
  "028-add-coordinates.ts",
  "029-allow-guest-orders.ts",
  "030-add-guest-order-access.ts",
  "031-add-order-contact-email.ts",
  "032-add-payment-cancelled-status.ts",
  "033-add-order-cart-id.ts",
  "034-add-order-commerce-exception.ts",
  "036-add-return-request-quantity.ts",
  "037-add-partially-refunded-status.ts",
  "039-upgrade-shipments-for-ithink.ts",
  "041-add-return-item-received.ts"
] as const;
export const MIGRATION_FILE_NAMES = [
  ...INITIAL_SCHEMA_TABLES.map((table) => `${table.migrationName}.ts`),
  ...SCHEMA_ALTER_MIGRATION_NAMES
].sort((left, right) => left.localeCompare(right));
export const EXPECTED_MIGRATION_COUNT = MIGRATION_FILE_NAMES.length;

type LockRow = { lock_acquired: number | null };
type ReleaseRow = { lock_released: number | null };

export class MigrationLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MigrationLockError";
  }
}

export class UnsafeMigrationResetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeMigrationResetError";
  }
}

export function assertUniqueMigrationNames(names: readonly string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate migration names: ${[...duplicates].join(", ")}`);
  }
}

export function assertDownAllAllowed(options: { environment: string | undefined; databaseName: string; confirmed: boolean }): void {
  const environment = options.environment ?? "development";
  if (environment === "production") {
    throw new UnsafeMigrationResetError("db:migrate:down:all is blocked in production.");
  }
  if (options.databaseName !== databaseConfig.database) {
    throw new UnsafeMigrationResetError(`Connected database ${options.databaseName} does not match configured database ${databaseConfig.database}.`);
  }
  if (!options.confirmed) {
    throw new UnsafeMigrationResetError("Pass --confirm-local-schema-reset to confirm local rollback of all Stage 5 tables.");
  }
}

export function migrationSourceDirectory(): string {
  return path.dirname(fileURLToPath(import.meta.url)).replace(/\\/gu, "/");
}

export function createMigrator(database: Sequelize = sequelize): Umzug<MigrationContext> {
  assertUniqueMigrationNames(MIGRATION_FILE_NAMES);
  const glob = `${migrationSourceDirectory()}/[0-9][0-9][0-9]-*.{ts,js}`;

  return new Umzug<MigrationContext>({
    migrations: {
      glob,
      resolve: ({ name, path: migrationPath, context }) => ({
        name,
        up: async () => {
          if (!migrationPath) throw new Error(`Migration path missing for ${name}.`);
          const module = (await import(pathToFileURL(migrationPath).href)) as {
            up: (args: { context: MigrationContext }) => Promise<void>;
          };
          await module.up({ context });
        },
        down: async () => {
          if (!migrationPath) throw new Error(`Migration path missing for ${name}.`);
          const module = (await import(pathToFileURL(migrationPath).href)) as {
            down: (args: { context: MigrationContext }) => Promise<void>;
          };
          await module.down({ context });
        }
      })
    },
    context: { queryInterface: database.getQueryInterface(), sequelize: database },
    storage: new SequelizeStorage({ sequelize: database, tableName: "SequelizeMeta" }),
    logger: undefined
  });
}

export async function withMigrationLock<T>(database: Sequelize, operation: () => Promise<T>): Promise<T> {
  const [lockRow] = await database.query<LockRow>("SELECT GET_LOCK(:lockName, :timeoutSeconds) AS lock_acquired", {
    replacements: { lockName: MIGRATION_LOCK_NAME, timeoutSeconds: MIGRATION_LOCK_TIMEOUT_SECONDS },
    type: QueryTypes.SELECT
  });
  if (lockRow?.lock_acquired !== 1) {
    throw new MigrationLockError(`Could not acquire MySQL migration lock ${MIGRATION_LOCK_NAME}.`);
  }

  let result: T | undefined;
  let operationError: unknown;
  try {
    result = await operation();
  } catch (error) {
    operationError = error;
  }

  const [releaseRow] = await database.query<ReleaseRow>("SELECT RELEASE_LOCK(:lockName) AS lock_released", {
    replacements: { lockName: MIGRATION_LOCK_NAME },
    type: QueryTypes.SELECT
  });
  if (operationError !== undefined) {
    if (operationError instanceof Error) {
      throw operationError;
    }
    throw new Error(typeof operationError === "string" ? operationError : "Migration operation failed with a non-error rejection.");
  }
  if (releaseRow?.lock_released !== 1) {
    throw new MigrationLockError(`Could not release MySQL migration lock ${MIGRATION_LOCK_NAME}.`);
  }
  return result as T;
}

export async function currentDatabaseName(database: Sequelize = sequelize): Promise<string> {
  const [row] = await database.query<{ databaseName: string }>("SELECT DATABASE() AS databaseName", { type: QueryTypes.SELECT });
  return row?.databaseName ?? "";
}

export async function getMigrationStatus(database: Sequelize = sequelize): Promise<{ executed: MigrationMeta[]; pending: MigrationMeta[] }> {
  const migrator = createMigrator(database);
  const [executed, pending] = await Promise.all([migrator.executed(), migrator.pending()]);
  return { executed, pending };
}

export function expectedMigrationNames(): string[] {
  return [...MIGRATION_FILE_NAMES];
}

export function expectedBusinessTableNames(): string[] {
  return [...EXPECTED_BUSINESS_TABLE_NAMES];
}
