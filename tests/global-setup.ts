import { Sequelize } from "sequelize";
import { databaseConfig } from "../src/config/database.config.js";

export default async function () {
  // 1. Guard check
  const env = process.env.NODE_ENV;
  if (env !== "test") {
    throw new Error(`Test database setup can only run when NODE_ENV is "test". Current: ${env}`);
  }

  // Derive test database name
  const dbName = process.env.DB_NAME || "mypetmart_test";
  if (!dbName.endsWith("_test")) {
    throw new Error(`Test database name must end with "_test". Current: ${dbName}`);
  }

  // Connect to MySQL server without selecting a database first
  const rootSequelize = new Sequelize("", databaseConfig.username, databaseConfig.password, {
    dialect: "mysql",
    host: databaseConfig.host,
    port: databaseConfig.port,
    logging: false
  });

  try {
    await rootSequelize.authenticate();
    // Every run starts from a deterministic isolated schema. The guard above
    // prevents this reset from ever targeting a non-test database.
    await rootSequelize.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
    await rootSequelize.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
  } finally {
    await rootSequelize.close();
  }

  // Import sequelize and migrator to run migrations
  const { sequelize } = await import("../src/database/index.js");
  const { createMigrator } = await import("../src/database/migrations/migrator.js");

  // Run migrations on the test database
  const migrator = createMigrator(sequelize);
  await migrator.up();
}
