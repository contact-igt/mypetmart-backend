import { loadSeedConfig } from "../../config/seed.config.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../index.js";
import { assertSeedRollbackAllowed, createSeeder, getCurrentSeedDatabaseName, withSeederLock } from "../seeders/index.js";

try {
  const seedConfig = loadSeedConfig();
  await connectDatabase();
  const databaseName = await getCurrentSeedDatabaseName(sequelize);
  assertSeedRollbackAllowed({ environment: process.env.NODE_ENV, databaseName });
  const reverted = await withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).down());
  console.log(JSON.stringify({ database: databaseName, reverted: reverted.map((seeder) => seeder.name) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Seeder rollback command failed.");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
