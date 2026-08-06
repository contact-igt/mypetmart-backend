import { connectDatabase, disconnectDatabase } from "../database/index.js";
import { logger } from "../utils/logger.js";
import { databaseConfig } from "../config/database.config.js";

try {
  await connectDatabase();
  logger.info({ database: databaseConfig.database }, "Database connection check passed");
  await disconnectDatabase();
} catch (error) {
  logger.error({ err: error, database: databaseConfig.database }, "Database connection check failed");
  try {
    await disconnectDatabase();
  } catch {
    // Nothing useful to do during a failed standalone check.
  }
  process.exitCode = 1;
}
