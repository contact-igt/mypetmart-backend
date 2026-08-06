import { connectDatabase, disconnectDatabase, sequelize } from "../index.js";
import { assertDownAllAllowed, createMigrator, currentDatabaseName, withMigrationLock } from "../migrations/migrator.js";
import { assertOnlyExpectedSchemaTables } from "../migrations/schema-verifier.js";

try {
  await connectDatabase();
  const databaseName = await currentDatabaseName(sequelize);
  assertDownAllAllowed({ environment: process.env.NODE_ENV, databaseName, confirmed: process.argv.includes("--confirm-local-schema-reset") });
  await assertOnlyExpectedSchemaTables(sequelize);
  const reverted = await withMigrationLock(sequelize, async () => {
    const down = await createMigrator(sequelize).down({ to: 0 });
    await sequelize.getQueryInterface().dropTable("SequelizeMeta").catch(() => undefined);
    return down;
  });
  console.log(JSON.stringify({ reverted: reverted.map((migration) => migration.name), metadataTableDropped: true }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
} finally {
  await disconnectDatabase();
}
