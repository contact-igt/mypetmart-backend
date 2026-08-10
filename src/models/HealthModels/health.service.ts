import { databaseConfig } from "../../config/database.config.js";
import { serverConfig } from "../../config/server.config.js";
import { checkDatabaseConnection } from "../../database/index.js";
import { objectStorageService } from "../../services/object-storage/object-storage.service.js";

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
  objectStorage: {
    provider: "cloudflare_r2";
    status: "configured" | "not_configured";
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
    objectStorage: objectStorageService.getReadiness(),
    timestamp: new Date().toISOString()
  };
}
