import { APPLICATION_CONSTANTS } from "../../constants/application.constants.js";

export type HealthStatus = {
  status: "ok";
  service: string;
  version: string;
  timestamp: string;
};

export function getHealthStatus(): HealthStatus {
  return {
    status: "ok",
    service: APPLICATION_CONSTANTS.serviceName,
    version: APPLICATION_CONSTANTS.version,
    timestamp: new Date().toISOString()
  };
}
