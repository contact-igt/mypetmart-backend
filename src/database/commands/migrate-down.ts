import { connectDatabase, disconnectDatabase, sequelize } from "../index.js";
import { createMigrator, withMigrationLock } from "../migrations/migrator.js";

try {
  await connectDatabase();
  const reverted = await withMigrationLock(sequelize, async () => createMigrator(sequelize).down());
  console.log(JSON.stringify({ reverted: reverted.map((migration) => migration.name) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
