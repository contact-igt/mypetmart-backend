import { readFileSync } from "node:fs";

import type { Sequelize } from "sequelize";
import { describe, expect, it, vi } from "vitest";

import { parseSeedConfig } from "../../src/config/seed.config.js";
import {
  assertProductionSeedAllowed,
  assertSeedRollbackAllowed,
  assertUniqueSeederNames,
  getSeederMetadataTableStatus,
  SEEDER_LOCK_NAME,
  SEEDER_METADATA_TABLE_NAME,
  SeederLockError,
  SeederSafetyError,
  withSeederLock
} from "../../src/database/seeders/index.js";
import { BOOTSTRAP_SUPER_ADMIN_SEEDER_FILE_NAME } from "../../src/database/seeders/seeder.constants.js";
import { databaseConfig } from "../../src/config/database.config.js";

const validEnv = {
  SEED_SUPER_ADMIN_NAME: "Bootstrap Admin",
  SEED_SUPER_ADMIN_EMAIL: "ADMIN@EXAMPLE.COM",
  SEED_SUPER_ADMIN_PASSWORD: "StrongPass#123",
  SEED_SUPER_ADMIN_BCRYPT_ROUNDS: "12",
  ALLOW_PRODUCTION_SEED: "false"
};

describe("Stage 6 seeder runner", () => {
  it("uses deterministic seeder names and separate metadata", () => {
    expect(BOOTSTRAP_SUPER_ADMIN_SEEDER_FILE_NAME).toBe("202608060001-bootstrap-super-admin.ts");
    expect(SEEDER_METADATA_TABLE_NAME).toBe("SequelizeSeedMeta");
    expect(SEEDER_LOCK_NAME).toBe("mypetmart_data_seeders");
  });

  it("rejects duplicate seeder names", () => {
    expect(() => assertUniqueSeederNames(["202608060001-bootstrap-super-admin.ts", "202608060001-bootstrap-super-admin.ts"])).toThrow(/Duplicate seeder names/u);
  });

  it("normalizes and validates seed configuration without leaking password values", () => {
    const config = parseSeedConfig(validEnv);
    expect(config.SEED_SUPER_ADMIN_EMAIL).toBe("admin@example.com");
    expect(config.SEED_SUPER_ADMIN_BCRYPT_ROUNDS).toBe(12);

    expect(() => parseSeedConfig({ ...validEnv, SEED_SUPER_ADMIN_PASSWORD: "weak" })).toThrow(/SEED_SUPER_ADMIN_PASSWORD/u);
    expect(() => parseSeedConfig({ ...validEnv, SEED_SUPER_ADMIN_PASSWORD: "weak" })).not.toThrow(/weak/u);
    expect(() => parseSeedConfig({ ...validEnv, SEED_SUPER_ADMIN_EMAIL: "bad-email" })).toThrow(/valid email/u);
    expect(() => parseSeedConfig({ ...validEnv, SEED_SUPER_ADMIN_BCRYPT_ROUNDS: "4" })).toThrow(/at least 10/u);
  });

  it("blocks production seeding by default and allows explicit production seed opt-in", () => {
    const blockedConfig = parseSeedConfig(validEnv);
    const allowedConfig = parseSeedConfig({ ...validEnv, ALLOW_PRODUCTION_SEED: "true" });
    expect(() => assertProductionSeedAllowed("production", blockedConfig)).toThrow(SeederSafetyError);
    expect(() => assertProductionSeedAllowed("production", allowedConfig)).not.toThrow();
  });

  it("blocks unsafe seeder rollback commands", () => {
    expect(() => assertSeedRollbackAllowed({ environment: "production", databaseName: databaseConfig.database })).toThrow(SeederSafetyError);
    expect(() => assertSeedRollbackAllowed({ environment: "development", databaseName: "not_mypetmart" })).toThrow(SeederSafetyError);
    expect(() => assertSeedRollbackAllowed({ environment: "development", databaseName: databaseConfig.database, requireConfirmation: true, confirmed: false })).toThrow(SeederSafetyError);
    expect(() => assertSeedRollbackAllowed({ environment: "development", databaseName: databaseConfig.database, requireConfirmation: true, confirmed: true })).not.toThrow();
  });

  it("handles seeder advisory lock failure and release failure", async () => {
    const lockFailure = vi.fn().mockResolvedValueOnce([{ lock_acquired: 0 }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    await expect(withSeederLock({ query: lockFailure, transaction: vi.fn((cb: any) => cb({})) } as unknown as Sequelize, () => Promise.resolve(undefined))).rejects.toThrow(SeederLockError);

    const releaseFailure = vi.fn().mockResolvedValueOnce([{ lock_acquired: 1 }]).mockResolvedValueOnce([{ lock_released: 0 }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    await expect(withSeederLock({ query: releaseFailure, transaction: vi.fn((cb: any) => cb({})) } as unknown as Sequelize, () => Promise.resolve("ok"))).rejects.toThrow(SeederLockError);

    const releaseAfterFailure = vi.fn().mockResolvedValueOnce([{ lock_acquired: 1 }]).mockResolvedValueOnce([{ lock_released: 1 }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    await expect(withSeederLock({ query: releaseAfterFailure, transaction: vi.fn((cb: any) => cb({})) } as unknown as Sequelize, () => Promise.reject(new Error("operation failed")))).rejects.toThrow(/operation failed/u);
    expect(releaseAfterFailure).toHaveBeenCalledTimes(2);
  });

  it("maps seeder metadata table status safely", async () => {
    const query = vi.fn().mockResolvedValueOnce([{ tableName: "sequelizeseedmeta" }]);
    await expect(getSeederMetadataTableStatus({ query } as unknown as Sequelize)).resolves.toEqual({
      expectedName: "SequelizeSeedMeta",
      exists: true,
      physicalName: "sequelizeseedmeta"
    });
  });

  it("does not run seeders during application startup", () => {
    const startupSource = `${readFileSync("src/app.ts", "utf8")}\n${readFileSync("src/server.ts", "utf8")}\n${readFileSync("src/database/index.ts", "utf8")}`;
    expect(startupSource).not.toMatch(/seedBootstrapSuperAdmin|createSeeder|db:seed|runSeed/u);
  });
});
