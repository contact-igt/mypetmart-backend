import { createServer } from "node:http";

import { app } from "./app.js";
import { APPLICATION_CONSTANTS } from "./constants/application.constants.js";
import { logger } from "./utils/logger.js";

function getPort(): number {
  // Stage 3 will replace direct process.env access with typed configuration.
  const configuredPort = process.env.PORT;

  if (configuredPort === undefined || configuredPort.trim() === "") {
    return APPLICATION_CONSTANTS.defaultPort;
  }

  const parsedPort = Number(configuredPort);

  if (!Number.isInteger(parsedPort) || parsedPort <= 0 || parsedPort > 65535) {
    throw new Error("PORT must be an integer between 1 and 65535.");
  }

  return parsedPort;
}

const port = getPort();
const server = createServer(app);
let shutdownInProgress = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shutdownInProgress) {
    logger.warn({ signal }, "Shutdown already in progress");
    return;
  }

  shutdownInProgress = true;
  logger.info({ signal }, "Graceful shutdown started");

  server.close((error?: Error) => {
    if (error !== undefined) {
      logger.error({ err: error, signal }, "HTTP server shutdown failed");
      process.exitCode = 1;
    } else {
      logger.info({ signal }, "HTTP server closed");
    }
  });
}

server.on("error", (error: Error) => {
  logger.fatal({ err: error }, "HTTP server startup failed");
  process.exitCode = 1;
});

server.listen(port, () => {
  logger.info(
    {
      service: APPLICATION_CONSTANTS.serviceName,
      version: APPLICATION_CONSTANTS.version,
      port,
      apiBasePath: APPLICATION_CONSTANTS.apiBasePath
    },
    "HTTP server started"
  );
});

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

process.on("unhandledRejection", (reason) => {
  logger.fatal({ err: reason }, "Unhandled promise rejection");
  shutdown("SIGTERM");
});

process.on("uncaughtException", (error) => {
  logger.fatal({ err: error }, "Uncaught exception");
  shutdown("SIGTERM");
});
