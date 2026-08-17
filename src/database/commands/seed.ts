import { loadSeedConfig } from "../../config/seed.config.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../index.js";
import { assertMigrationsReady, assertProductionSeedAllowed, createSeeder, getCurrentSeedDatabaseName, withSeederLock } from "../seeders/index.js";

try {
  const seedConfig = loadSeedConfig();
  await connectDatabase();
  const databaseName = await getCurrentSeedDatabaseName(sequelize);
  await assertMigrationsReady(sequelize);
  assertProductionSeedAllowed(process.env.NODE_ENV, seedConfig);
  const seeded = await withSeederLock(sequelize, async () => createSeeder(seedConfig, sequelize).up());
  console.log(JSON.stringify({ database: databaseName, seeded: seeded.map((seeder) => seeder.name) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Seeder command failed.");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
