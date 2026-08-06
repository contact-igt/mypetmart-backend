import { APPLICATION_CONSTANTS } from "../constants/application.constants.js";
import { environmentConfig } from "./environment.config.js";

export const serverConfig = Object.freeze({
  environment: environmentConfig.NODE_ENV,
  port: environmentConfig.PORT,
  logLevel: environmentConfig.LOG_LEVEL,
  requestBodyLimit: environmentConfig.REQUEST_BODY_LIMIT,
  serviceName: APPLICATION_CONSTANTS.serviceName,
  serviceVersion: APPLICATION_CONSTANTS.version,
  apiVersion: APPLICATION_CONSTANTS.apiVersion,
  apiBasePath: APPLICATION_CONSTANTS.apiBasePath
});
