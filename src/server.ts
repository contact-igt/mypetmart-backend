import { createServer } from "node:http";

import { app } from "./app.js";
import { databaseConfig } from "./config/database.config.js";
import { serverConfig } from "./config/server.config.js";
import { connectDatabase, disconnectDatabase } from "./database/index.js";
import { logger } from "./utils/logger.js";

const server = createServer(app);
let shutdownInProgress = false;
let httpServerStarted = false;

function closeHttpServer(): Promise<void> {
  if (!httpServerStarted) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shutdownInProgress) {
    logger.warn({ signal }, "Shutdown already in progress");
    return;
  }

  shutdownInProgress = true;
  logger.info({ signal }, "Graceful shutdown started");

  const safetyTimeout = setTimeout(() => {
    logger.error({ signal }, "Graceful shutdown timed out");
    process.exit(1);
  }, 10000);

  try {
    await closeHttpServer();
    httpServerStarted = false;
    logger.info({ signal }, "HTTP server closed");

    await disconnectDatabase();
    logger.info({ signal }, "Database connection closed");

    clearTimeout(safetyTimeout);
    process.exit(0);
  } catch (error) {
    clearTimeout(safetyTimeout);
    logger.error({ err: error, signal }, "Graceful shutdown failed");
    process.exit(1);
  }
}

async function bootstrap(): Promise<void> {
  try {
    await connectDatabase();
    logger.info({ database: databaseConfig.database }, "Database connection established");

    server.on("error", (error: Error) => {
      logger.fatal({ err: error }, "HTTP server startup failed");
      process.exit(1);
    });

    server.listen(serverConfig.port, () => {
      httpServerStarted = true;
      logger.info(
        {
          service: serverConfig.serviceName,
          version: serverConfig.serviceVersion,
          environment: serverConfig.environment,
          port: serverConfig.port,
          apiBasePath: serverConfig.apiBasePath,
          database: databaseConfig.database
        },
        "HTTP server started"
      );
    });
  } catch (error) {
    logger.fatal({ err: error, database: databaseConfig.database }, "Application startup failed before HTTP listen");
    try {
      await disconnectDatabase();
    } catch {
      // The database may not have opened; avoid masking the startup failure.
    }
    process.exit(1);
  }
}

process.on("SIGINT", (signal) => {
  void shutdown(signal);
});

process.on("SIGTERM", (signal) => {
  void shutdown(signal);
});

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  void shutdown("SIGTERM");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  void shutdown("SIGTERM");
});

void bootstrap();
