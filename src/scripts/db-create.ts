import mysql from "mysql2/promise";
import { databaseConfig } from "../config/database.config.js";
import { logger } from "../utils/logger.js";

async function createDatabase() {
  const connection = await mysql.createConnection({
    host: databaseConfig.host,
    port: databaseConfig.port,
    user: databaseConfig.username,
    password: databaseConfig.password
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${databaseConfig.database}\`;`);
  logger.info({ database: databaseConfig.database }, "Database ensured / created successfully");
  await connection.end();
}

createDatabase().catch((error) => {
  logger.error({ err: error }, "Failed to create database");
  process.exit(1);
});
