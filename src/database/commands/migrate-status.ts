import { connectDatabase, disconnectDatabase, sequelize } from "../index.js";
import { currentDatabaseName, getMigrationStatus } from "../migrations/migrator.js";

try {
  await connectDatabase();
  const [databaseName, status] = await Promise.all([currentDatabaseName(sequelize), getMigrationStatus(sequelize)]);
  console.log(JSON.stringify({ database: databaseName, executed: status.executed.map((migration) => migration.name), pending: status.pending.map((migration) => migration.name) }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
