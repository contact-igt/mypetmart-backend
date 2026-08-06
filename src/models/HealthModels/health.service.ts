import { databaseConfig } from "../../config/database.config.js";
import { serverConfig } from "../../config/server.config.js";
import { checkDatabaseConnection } from "../../database/index.js";

export type HealthStatus = {
  status: "ok";
  service: string;
  version: string;
  timestamp: string;
};

export type ReadinessStatus = {
  status: "ready";
  service: string;
  database: {
    status: "connected";
    name: string;
  };
  timestamp: string;
};

export function getHealthStatus(): HealthStatus {
  return {
    status: "ok",
    service: serverConfig.serviceName,
    version: serverConfig.serviceVersion,
    timestamp: new Date().toISOString()
  };
}

export async function getReadinessStatus(): Promise<ReadinessStatus | undefined> {
  const databaseConnected = await checkDatabaseConnection();

  if (!databaseConnected) {
    return undefined;
  }

  return {
    status: "ready",
    service: serverConfig.serviceName,
    database: {
      status: "connected",
      name: databaseConfig.database
    },
    timestamp: new Date().toISOString()
  };
}
