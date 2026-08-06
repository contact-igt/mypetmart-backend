import { connectDatabase, disconnectDatabase, sequelize } from "../index.js";
import { createMigrator, withMigrationLock } from "../migrations/migrator.js";

try {
  await connectDatabase();
  const migrated = await withMigrationLock(sequelize, async () => createMigrator(sequelize).up());
  console.log(JSON.stringify({ migrated: migrated.map((migration) => migration.name) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
