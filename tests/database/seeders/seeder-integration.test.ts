import { QueryTypes } from "sequelize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseSeedConfig, type SeedConfig } from "../../../src/config/seed.config.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../../src/database/index.js";
import { createSeeder, getSeederStatus, seedBootstrapSuperAdmin, withSeederLock } from "../../../src/database/seeders/index.js";
import { isBcryptHash } from "../../../src/database/seeders/bootstrap-super-admin.js";

type CountRow = { count: number };
type HashRow = { passwordHash: string };

const fakeEnv = {
  SEED_SUPER_ADMIN_NAME: "Stage Six Test Admin",
  SEED_SUPER_ADMIN_EMAIL: "Stage6.Admin@Example.Test",
  SEED_SUPER_ADMIN_PHONE: "9999999999",
  SEED_SUPER_ADMIN_PASSWORD: "TestOnly#12345",
  SEED_SUPER_ADMIN_BCRYPT_ROUNDS: "10",
  ALLOW_PRODUCTION_SEED: "false"
};

const seedConfig = parseSeedConfig(fakeEnv);
const conflictEmails = {
  customer: "customer-conflict@example.test",
  admin: "admin-conflict@example.test",
  disabled: "disabled-conflict@example.test",
  orderCustomer: "order-customer@example.test"
};
const conflictPasswordHashPlaceholder = "seed-conflict-placeholder-hash";

async function getMigrationNames(): Promise<string[]> {
  const rows = await sequelize.query<{ name: string }>("SELECT name FROM SequelizeMeta ORDER BY name", { type: QueryTypes.SELECT });
  return rows.map((r) => r.name);
}

async function count(sql: string, replacements: Record<string, unknown> = {}): Promise<number> {
  const [row] = await sequelize.query<CountRow>(sql, { replacements, type: QueryTypes.SELECT });
  return row?.count ?? 0;
}

async function adminCount(config: SeedConfig): Promise<number> {
  return count("SELECT COUNT(*) AS count FROM users WHERE email = :email AND role = 'super_admin'", {
    email: config.SEED_SUPER_ADMIN_EMAIL
  });
}

async function passwordHash(config: SeedConfig): Promise<string> {
  const [row] = await sequelize.query<HashRow>("SELECT password_hash AS passwordHash FROM users WHERE email = :email", {
    replacements: { email: config.SEED_SUPER_ADMIN_EMAIL },
    type: QueryTypes.SELECT
  });
  return row?.passwordHash ?? "";
}

async function cleanupSeed(config: SeedConfig): Promise<void> {
  const status = await getSeederStatus(config, sequelize);
  if (status.executed.length > 0) {
    await withSeederLock(sequelize, async () => createSeeder(config, sequelize).down({ to: 0 }));
  }
  await sequelize.query("DELETE FROM users WHERE email = :email", {
    replacements: { email: config.SEED_SUPER_ADMIN_EMAIL }
  });
}

async function cleanupConflicts(): Promise<void> {
  await sequelize.query("DELETE FROM order_notes WHERE message = 'Audit note'");
  await sequelize.query("DELETE FROM orders WHERE ship_recipient_name = 'Order Customer'");
  await sequelize.query("DELETE FROM users WHERE email IN (:emails)", {
    replacements: {
      emails: Object.values(conflictEmails)
    }
  });
}

describe("Stage 6 bootstrap super-admin seeder integration", () => {
  beforeAll(async () => {
    await connectDatabase();
    await cleanupConflicts();
    await cleanupSeed(seedConfig);
  });

  afterAll(async () => {
    await cleanupConflicts();
    await cleanupSeed(seedConfig);
    await disconnectDatabase();
  });

  it("applies, reruns idempotently, rolls back safely, and protects migration/catalog state", async () => {
    const migrationNamesBefore = await getMigrationNames();
    expect(migrationNamesBefore.length).toBeGreaterThan(0);

    const statusBefore = await getSeederStatus(seedConfig, sequelize);
    expect(statusBefore.executed).toHaveLength(0);
    expect(statusBefore.pending.map((seeder) => seeder.name)).toEqual(["202608060001-bootstrap-super-admin.ts"]);

    await withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).up());
    expect(await adminCount(seedConfig)).toBe(1);
    const firstHash = await passwordHash(seedConfig);
    expect(isBcryptHash(firstHash)).toBe(true);
    expect(firstHash).not.toBe(seedConfig.SEED_SUPER_ADMIN_PASSWORD);

    await withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).up());
    expect(await adminCount(seedConfig)).toBe(1);
    expect(await passwordHash(seedConfig)).toBe(firstHash);

    const statusAfterSeed = await getSeederStatus(seedConfig, sequelize);
    expect(statusAfterSeed.executed.map((seeder) => seeder.name)).toEqual(["202608060001-bootstrap-super-admin.ts"]);
    expect(statusAfterSeed.pending).toHaveLength(0);

    await withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).down());
    expect(await adminCount(seedConfig)).toBe(0);
    expect(await getMigrationNames()).toEqual(migrationNamesBefore);

    await withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).up());
    expect(await adminCount(seedConfig)).toBe(1);
    expect(await count("SELECT COUNT(*) AS count FROM categories")).toBe(0);
    expect(await count("SELECT COUNT(*) AS count FROM products")).toBe(0);
    expect(await count("SELECT COUNT(*) AS count FROM orders")).toBe(0);
    expect(await count("SELECT COUNT(*) AS count FROM payments")).toBe(0);
    expect(await getMigrationNames()).toEqual(migrationNamesBefore);
  });

  it("fails safely for existing-user conflicts", async () => {
    await cleanupSeed(seedConfig);
    await cleanupConflicts();

    await sequelize.query("INSERT INTO users (id, role, status, name, email, password_hash) VALUES (5001, 'customer', 'active', 'Customer Conflict', :email, :hash)", {
      replacements: { email: seedConfig.SEED_SUPER_ADMIN_EMAIL, hash: conflictPasswordHashPlaceholder }
    });
    await expect(seedBootstrapSuperAdmin(sequelize, seedConfig)).rejects.toMatchObject({ code: "SEED_SUPER_ADMIN_ROLE_CONFLICT" });
    await cleanupSeed(seedConfig);

    await sequelize.query("INSERT INTO users (id, role, status, name, email, password_hash) VALUES (5002, 'admin', 'active', 'Admin Conflict', :email, :hash)", {
      replacements: { email: seedConfig.SEED_SUPER_ADMIN_EMAIL, hash: conflictPasswordHashPlaceholder }
    });
    await expect(seedBootstrapSuperAdmin(sequelize, seedConfig)).rejects.toMatchObject({ code: "SEED_SUPER_ADMIN_ROLE_CONFLICT" });
    await cleanupSeed(seedConfig);

    await sequelize.query("INSERT INTO users (id, role, status, name, email, password_hash) VALUES (5003, 'super_admin', 'disabled', 'Disabled Conflict', :email, :hash)", {
      replacements: { email: seedConfig.SEED_SUPER_ADMIN_EMAIL, hash: conflictPasswordHashPlaceholder }
    });
    await expect(seedBootstrapSuperAdmin(sequelize, seedConfig)).rejects.toMatchObject({ code: "SEED_SUPER_ADMIN_DISABLED_CONFLICT" });
    await cleanupSeed(seedConfig);
  });

  it("blocks rollback when the owned admin has dependent audit notes", async () => {
    await cleanupSeed(seedConfig);
    await withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).up());
    
    const adminRows = await sequelize.query<{ adminId: number }>("SELECT id AS adminId FROM users WHERE email = :email LIMIT 1", {
      replacements: { email: seedConfig.SEED_SUPER_ADMIN_EMAIL },
      type: QueryTypes.SELECT
    });
    const adminId = adminRows[0]?.adminId;
    if (!adminId) throw new Error("Admin not found");

    await sequelize.query("INSERT INTO users (id, role, status, name, email, password_hash) VALUES (5004, 'customer', 'active', 'Order Customer', :email, :hash)", {
      replacements: { email: conflictEmails.orderCustomer, hash: conflictPasswordHashPlaceholder }
    });
    
    const customerRows = await sequelize.query<{ customerId: number }>("SELECT id AS customerId FROM users WHERE email = :email LIMIT 1", {
      replacements: { email: conflictEmails.orderCustomer },
      type: QueryTypes.SELECT
    });
    const customerId = customerRows[0]?.customerId;
    if (!customerId) throw new Error("Customer not found");

    await sequelize.query("INSERT INTO orders (id, order_number, user_id, ship_recipient_name, ship_phone, ship_line_1, ship_city, ship_state, ship_postal_code) VALUES (6001, 'STAGE6-ORDER-1', :userId, 'Order Customer', '9999999999', 'Line', 'City', 'State', '123456')", {
      replacements: { userId: customerId }
    });
    
    const orderRows = await sequelize.query<{ orderId: number }>("SELECT id AS orderId FROM orders WHERE user_id = :userId LIMIT 1", {
      replacements: { userId: customerId },
      type: QueryTypes.SELECT
    });
    const orderId = orderRows[0]?.orderId;
    if (!orderId) throw new Error("Order not found");

    await sequelize.query("INSERT INTO order_notes (id, order_id, admin_id, message) VALUES (7001, :orderId, :adminId, 'Audit note')", {
      replacements: { orderId, adminId }
    });

    await expect(withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).down())).rejects.toThrow(/dependent audit records/u);
    await cleanupConflicts();
    await withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).down());
    expect(await adminCount(seedConfig)).toBe(0);
  });
});
