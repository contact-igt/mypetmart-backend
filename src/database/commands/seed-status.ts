import { connectDatabase, disconnectDatabase, sequelize } from "../index.js";
import { getCurrentSeedDatabaseName, getSeederMetadataTableStatus, getSeederStatus } from "../seeders/index.js";

try {
  await connectDatabase();
  const [databaseName, status, metadataTable] = await Promise.all([
    getCurrentSeedDatabaseName(sequelize),
    getSeederStatus(undefined, sequelize),
    getSeederMetadataTableStatus(sequelize)
  ]);
  console.log(
    JSON.stringify(
      {
        database: databaseName,
        metadataTable,
        executed: status.executed.map((seeder) => seeder.name),
        pending: status.pending.map((seeder) => seeder.name)
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Seeder status command failed.");
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
