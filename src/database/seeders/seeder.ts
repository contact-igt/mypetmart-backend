import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

import { QueryTypes, type Sequelize } from "sequelize";
import { SequelizeStorage, Umzug, type MigrationMeta } from "umzug";

import type { SeedConfig } from "../../config/seed.config.js";
import { databaseConfig } from "../../config/database.config.js";
import { sequelize } from "../index.js";
import { currentDatabaseName, EXPECTED_MIGRATION_COUNT, getMigrationStatus } from "../migrations/migrator.js";
import { BOOTSTRAP_SUPER_ADMIN_SEEDER_FILE_NAME, SEEDER_LOCK_NAME, SEEDER_LOCK_TIMEOUT_SECONDS, SEEDER_METADATA_TABLE_NAME } from "./seeder.constants.js";
import type { SeederContext } from "./seeder.types.js";

type LockRow = { lock_acquired: number | null };
type ReleaseRow = { lock_released: number | null };
type TableRow = { tableName: string };

export class SeederLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeederLockError";
  }
}

export class SeederSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SeederSafetyError";
  }
}

export const SEEDER_FILE_NAMES = [BOOTSTRAP_SUPER_ADMIN_SEEDER_FILE_NAME] as const;

export function assertUniqueSeederNames(names: readonly string[]): void {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicates.add(name);
    seen.add(name);
  }
  if (duplicates.size > 0) {
    throw new Error(`Duplicate seeder names: ${[...duplicates].join(", ")}`);
  }
}

export function seederSourceDirectory(): string {
  return path.dirname(fileURLToPath(import.meta.url)).replace(/\\/gu, "/");
}

export function createSeeder(seedConfig?: SeedConfig, database: Sequelize = sequelize): Umzug<SeederContext> {
  assertUniqueSeederNames(SEEDER_FILE_NAMES);
  const glob = `${seederSourceDirectory()}/[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-*.{ts,js}`;

  return new Umzug<SeederContext>({
    migrations: {
      glob,
      resolve: ({ name, path: seederPath, context }) => ({
        name,
        up: async () => {
          if (!seederPath) throw new Error(`Seeder path missing for ${name}.`);
          const module = (await import(pathToFileURL(seederPath).href)) as {
            up: (args: { context: SeederContext }) => Promise<void>;
          };
          await module.up({ context });
        },
        down: async () => {
          if (!seederPath) throw new Error(`Seeder path missing for ${name}.`);
          const module = (await import(pathToFileURL(seederPath).href)) as {
            down: (args: { context: SeederContext }) => Promise<void>;
          };
          await module.down({ context });
        }
      })
    },
    context: { queryInterface: database.getQueryInterface(), sequelize: database, ...(seedConfig === undefined ? {} : { seedConfig }) },
    storage: new SequelizeStorage({ sequelize: database, modelName: SEEDER_METADATA_TABLE_NAME, tableName: SEEDER_METADATA_TABLE_NAME }),
    logger: undefined
  });
}

export async function withSeederLock<T>(database: Sequelize, operation: () => Promise<T>): Promise<T> {
  return await database.transaction(async (t) => {
    const [lockRow] = await database.query<LockRow>("SELECT GET_LOCK(:lockName, :timeoutSeconds) AS lock_acquired", {
      replacements: { lockName: SEEDER_LOCK_NAME, timeoutSeconds: SEEDER_LOCK_TIMEOUT_SECONDS },
      type: QueryTypes.SELECT,
      transaction: t
    });
    if (lockRow?.lock_acquired !== 1) {
      throw new SeederLockError(`Could not acquire MySQL seeder lock ${SEEDER_LOCK_NAME}.`);
    }

    let result: T | undefined;
    let operationError: unknown;
    try {
      result = await operation();
    } catch (error) {
      operationError = error;
    }

    const [releaseRow] = await database.query<ReleaseRow>("SELECT RELEASE_LOCK(:lockName) AS lock_released", {
      replacements: { lockName: SEEDER_LOCK_NAME },
      type: QueryTypes.SELECT,
      transaction: t
    });
    if (operationError !== undefined) {
      if (operationError instanceof Error) {
        throw operationError;
      }
      throw new Error(typeof operationError === "string" ? operationError : "Seeder operation failed with a non-error rejection.");
    }
    if (releaseRow?.lock_released !== 1) {
      throw new SeederLockError(`Could not release MySQL seeder lock ${SEEDER_LOCK_NAME}.`);
    }
    return result as T;
  });
}

export function assertProductionSeedAllowed(environment: string | undefined, seedConfig: SeedConfig): void {
  if ((environment ?? "development") === "production" && !seedConfig.ALLOW_PRODUCTION_SEED) {
    throw new SeederSafetyError("db:seed is blocked in production unless ALLOW_PRODUCTION_SEED=true.");
  }
}

export function assertSeedRollbackAllowed(options: { environment: string | undefined; databaseName: string; confirmed?: boolean; requireConfirmation?: boolean }): void {
  if ((options.environment ?? "development") === "production") {
    throw new SeederSafetyError("Seeder rollback is blocked in production.");
  }
  if (options.databaseName !== databaseConfig.database) {
    throw new SeederSafetyError(`Connected database ${options.databaseName} does not match configured database ${databaseConfig.database}.`);
  }
  if (options.requireConfirmation === true && options.confirmed !== true) {
    throw new SeederSafetyError("Pass --confirm-local-seed-reset to confirm local seed rollback.");
  }
}

export async function assertMigrationsReady(database: Sequelize = sequelize): Promise<void> {
  const status = await getMigrationStatus(database);
  if (status.pending.length > 0) {
    throw new SeederSafetyError(`Cannot run seeders while migrations are pending: ${status.pending.map((migration) => migration.name).join(", ")}`);
  }
  if (status.executed.length !== EXPECTED_MIGRATION_COUNT) {
    throw new SeederSafetyError(`Expected ${EXPECTED_MIGRATION_COUNT} executed migrations, found ${status.executed.length}.`);
  }
}

export async function getSeederStatus(seedConfig?: SeedConfig, database: Sequelize = sequelize): Promise<{ executed: MigrationMeta[]; pending: MigrationMeta[] }> {
  const seeder = createSeeder(seedConfig, database);
  const [executed, pending] = await Promise.all([seeder.executed(), seeder.pending()]);
  return { executed, pending };
}

export async function getSeederMetadataTableStatus(database: Sequelize = sequelize): Promise<{ expectedName: string; exists: boolean; physicalName: string | null }> {
  const [row] = await database.query<TableRow>(
    "SELECT table_name AS tableName FROM information_schema.tables WHERE table_schema = DATABASE() AND LOWER(table_name) = LOWER(:tableName) LIMIT 1",
    { replacements: { tableName: SEEDER_METADATA_TABLE_NAME }, type: QueryTypes.SELECT }
  );
  return { expectedName: SEEDER_METADATA_TABLE_NAME, exists: row !== undefined, physicalName: row?.tableName ?? null };
}

export async function getCurrentSeedDatabaseName(database: Sequelize = sequelize): Promise<string> {
  return currentDatabaseName(database);
}


