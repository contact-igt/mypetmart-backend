import { loadSeedConfig } from "../../config/seed.config.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../index.js";
import { assertSeedRollbackAllowed, createSeeder, getCurrentSeedDatabaseName, withSeederLock } from "../seeders/index.js";
import { BOOTSTRAP_SUPER_ADMIN_SAFE_ROLLBACK_CONFIRMATION } from "../seeders/seeder.constants.js";

try {
  const seedConfig = loadSeedConfig();
  await connectDatabase();
  const databaseName = await getCurrentSeedDatabaseName(sequelize);
  assertSeedRollbackAllowed({
    environment: process.env.NODE_ENV,
    databaseName,
    confirmed: process.argv.includes(BOOTSTRAP_SUPER_ADMIN_SAFE_ROLLBACK_CONFIRMATION),
    requireConfirmation: true
  });
  const reverted = await withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).down({ to: 0 }));
  console.log(JSON.stringify({ database: databaseName, reverted: reverted.map((seeder) => seeder.name) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Seeder rollback command failed.");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
