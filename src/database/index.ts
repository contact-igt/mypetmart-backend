import { Sequelize } from "sequelize";

import { databaseConfig } from "../config/database.config.js";
import { logger } from "../utils/logger.js";
import { initializeDatabaseAssociations } from "./associations.js";
import { initializeDatabaseModels } from "./tables/index.js";

export const sequelize = new Sequelize(databaseConfig.database, databaseConfig.username, databaseConfig.password, {
  dialect: databaseConfig.dialect,
  host: databaseConfig.host,
  port: databaseConfig.port,
  pool: databaseConfig.pool,
  logging: databaseConfig.logging
    ? (sql) => {
        logger.debug({ sql }, "Sequelize SQL query");
      }
    : false
});

export const databaseModels = initializeDatabaseModels(sequelize);
initializeDatabaseAssociations(databaseModels);

export async function connectDatabase(): Promise<void> {
  await sequelize.authenticate();
}

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await sequelize.authenticate();
    return true;
  } catch (error) {
    logger.warn({ err: error, database: databaseConfig.database }, "Database readiness check failed");
    return false;
  }
}

export async function disconnectDatabase(): Promise<void> {
  await sequelize.close();
}