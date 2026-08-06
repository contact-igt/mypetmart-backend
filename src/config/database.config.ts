import type { Options } from "sequelize";

import { environmentConfig } from "./environment.config.js";

export const databaseConfig = Object.freeze({
  dialect: "mysql" as const,
  host: environmentConfig.DB_HOST,
  port: environmentConfig.DB_PORT,
  database: environmentConfig.DB_NAME,
  username: environmentConfig.DB_USER,
  password: environmentConfig.DB_PASSWORD,
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
