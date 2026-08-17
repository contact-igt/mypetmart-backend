import type { CorsOptions } from "cors";

import { ApplicationError } from "../utils/application-error.js";
import { environmentConfig } from "./environment.config.js";

function parseOrigins(value: string): string[] {
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

const parsedAllowedOrigins = [
  ...parseOrigins(environmentConfig.STOREFRONT_ORIGIN),
  ...parseOrigins(environmentConfig.ADMIN_ORIGIN)
];

export const corsConfig = Object.freeze({
  allowedOrigins: Object.freeze(parsedAllowedOrigins),
  allowedMethods: Object.freeze(["GET", "POST", "PATCH", "DELETE", "OPTIONS"]),
  allowedHeaders: Object.freeze(["Content-Type", "Authorization", "X-Request-Id"]),
  credentials: true
});

function isAllowedOrigin(origin: string): boolean {
  return corsConfig.allowedOrigins.includes(origin);
}

export const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (origin === undefined || isAllowedOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(
      new ApplicationError({
        statusCode: 403,
        code: "CORS_ORIGIN_NOT_ALLOWED",
        message: "The request origin is not allowed."
      })
    );
  },
  methods: [...corsConfig.allowedMethods],
  allowedHeaders: [...corsConfig.allowedHeaders],
  credentials: corsConfig.credentials,
  optionsSuccessStatus: 204
};
