import pino from "pino";
import { pinoHttp } from "pino-http";

import { APPLICATION_CONSTANTS } from "../constants/application.constants.js";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: {
    service: APPLICATION_CONSTANTS.serviceName
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
      "*.secret"
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
