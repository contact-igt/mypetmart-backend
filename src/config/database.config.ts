import type { Options } from "sequelize";

import { environmentConfig } from "./environment.config.js";

const isProduction = environmentConfig.NODE_ENV === "production";

export const databaseConfig = Object.freeze({
  dialect: "mysql" as const,
  host: isProduction && environmentConfig.PRODUCTION_DB_HOST ? environmentConfig.PRODUCTION_DB_HOST : environmentConfig.DB_HOST,
  port: isProduction && environmentConfig.PRODUCTION_DB_PORT ? environmentConfig.PRODUCTION_DB_PORT : environmentConfig.DB_PORT,
  database: isProduction && environmentConfig.PRODUCTION_DB_NAME ? environmentConfig.PRODUCTION_DB_NAME : environmentConfig.DB_NAME,
  username: isProduction && environmentConfig.PRODUCTION_DB_USER ? environmentConfig.PRODUCTION_DB_USER : environmentConfig.DB_USER,
  password: isProduction && environmentConfig.PRODUCTION_DB_PASSWORD !== undefined ? environmentConfig.PRODUCTION_DB_PASSWORD : environmentConfig.DB_PASSWORD,
  logging: environmentConfig.DB_LOGGING,
  pool: Object.freeze({
    max: environmentConfig.DB_POOL_MAX,
    min: environmentConfig.DB_POOL_MIN,
    acquire: environmentConfig.DB_POOL_ACQUIRE_MS,
    idle: environmentConfig.DB_POOL_IDLE_MS
  })
});

export type DatabaseConfig = typeof databaseConfig;

export function getSequelizeOptions(): Options {
  return {
    dialect: databaseConfig.dialect,
    host: databaseConfig.host,
    port: databaseConfig.port,
    pool: databaseConfig.pool
  };
}
