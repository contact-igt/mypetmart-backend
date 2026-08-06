import pino from "pino";
import { pinoHttp } from "pino-http";

import { serverConfig } from "../config/server.config.js";

export const logger = pino({
  level: serverConfig.logLevel,
  base: {
    service: serverConfig.serviceName
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body",
      "res.headers.set-cookie",
      "password",
      "*.password",
      "*.token",
      "*.secret",
      "*.accessKey",
      "*.secretKey"
    ],
    censor: "[redacted]"
  }
});

export const httpLogger = pinoHttp({
  logger,
  genReqId(request) {
    return request.requestId ?? "missing-request-id";
  },
  customProps(request) {
    return {
      requestId: request.requestId
    };
  }
});
