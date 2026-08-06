import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { z } from "zod";

const SECRET_FIELD_NAMES = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "R2_SECRET_ACCESS_KEY",
  "PAYMENT_KEY_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "SHIPPING_API_KEY",
  "SHIPPING_WEBHOOK_SECRET",
  "DB_PASSWORD"
] as const;

const PLACEHOLDER_VALUES = new Set([
  "replace_with_a_long_random_secret",
  "replace_with_a_different_long_random_secret"
]);

function loadLocalEnvironmentFile(): void {
  if (existsSync(".env")) {
    loadEnvFile(".env");
  }
}

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmedValue = value.trim();
  return trimmedValue.length > 0 ? trimmedValue : undefined;
}

const optionalTrimmedStringSchema = z.preprocess(optionalString, z.string().optional());

function requiredString(name: string) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string({ error: `${name} is required.` }).min(1, `${name} is required.`)
  );
}

function integerFromString(name: string, minimum: number, maximum: number) {
  return z.preprocess(
    (value) => {
      if (typeof value === "number") {
        return value;
      }

      if (typeof value !== "string") {
        return value;
      }

      const trimmedValue = value.trim();
      if (trimmedValue.length === 0) {
        return undefined;
      }

      return Number(trimmedValue);
    },
    z
      .number({ error: `${name} must be a number.` })
      .int(`${name} must be an integer.`)
      .min(minimum, `${name} must be at least ${minimum}.`)
      .max(maximum, `${name} must be at most ${maximum}.`)
  );
}

function booleanFromString(name: string) {
  return z.preprocess((value) => {
    if (typeof value === "boolean") {
      return value;
    }

    if (typeof value !== "string") {
      return value;
    }

    const normalizedValue = value.trim().toLowerCase();
    if (normalizedValue === "true") {
      return true;
    }

    if (normalizedValue === "false") {
      return false;
    }

    return value;
  }, z.boolean({ error: `${name} must be true or false.` }));
}

const environmentSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: integerFromString("PORT", 1, 65535).default(5000),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    REQUEST_BODY_LIMIT: requiredString("REQUEST_BODY_LIMIT").default("1mb"),

    STOREFRONT_ORIGIN: z.url("STOREFRONT_ORIGIN must be a valid URL."),
    ADMIN_ORIGIN: z.url("ADMIN_ORIGIN must be a valid URL."),

    DB_HOST: requiredString("DB_HOST"),
    DB_PORT: integerFromString("DB_PORT", 1, 65535),
    DB_NAME: requiredString("DB_NAME").default("mypetmart"),
    DB_USER: requiredString("DB_USER"),
    DB_PASSWORD: z.string().default(""),
    DB_LOGGING: booleanFromString("DB_LOGGING").default(false),
    DB_POOL_MAX: integerFromString("DB_POOL_MAX", 1, 100).default(10),
    DB_POOL_MIN: integerFromString("DB_POOL_MIN", 0, 100).default(0),
    DB_POOL_ACQUIRE_MS: integerFromString("DB_POOL_ACQUIRE_MS", 1000, 120000).default(30000),
    DB_POOL_IDLE_MS: integerFromString("DB_POOL_IDLE_MS", 1000, 120000).default(10000),

    JWT_ACCESS_SECRET: optionalTrimmedStringSchema,
    JWT_REFRESH_SECRET: optionalTrimmedStringSchema,
    JWT_ACCESS_EXPIRES_IN: optionalTrimmedStringSchema.default("15m"),
    JWT_REFRESH_EXPIRES_IN: optionalTrimmedStringSchema.default("30d"),

    R2_ACCOUNT_ID: optionalTrimmedStringSchema,
    R2_ACCESS_KEY_ID: optionalTrimmedStringSchema,
    R2_SECRET_ACCESS_KEY: optionalTrimmedStringSchema,
    R2_BUCKET: optionalTrimmedStringSchema,
    R2_PUBLIC_BASE_URL: optionalTrimmedStringSchema,

    PAYMENT_PROVIDER: optionalTrimmedStringSchema,
    PAYMENT_KEY_ID: optionalTrimmedStringSchema,
    PAYMENT_KEY_SECRET: optionalTrimmedStringSchema,
    PAYMENT_WEBHOOK_SECRET: optionalTrimmedStringSchema,

    SHIPPING_PROVIDER: optionalTrimmedStringSchema,
    SHIPPING_API_KEY: optionalTrimmedStringSchema,
    SHIPPING_WEBHOOK_SECRET: optionalTrimmedStringSchema
  })
  .superRefine((value, context) => {
    if (value.DB_POOL_MIN > value.DB_POOL_MAX) {
      context.addIssue({
        code: "custom",
        path: ["DB_POOL_MIN"],
        message: "DB_POOL_MIN must be less than or equal to DB_POOL_MAX."
      });
    }

    if (value.NODE_ENV === "production") {
      for (const fieldName of SECRET_FIELD_NAMES) {
        const secretValue = value[fieldName];
        if (typeof secretValue === "string" && PLACEHOLDER_VALUES.has(secretValue)) {
          context.addIssue({
            code: "custom",
            path: [fieldName],
            message: `${fieldName} must not use an example placeholder in production.`
          });
        }
      }
    }
  });

export type EnvironmentConfig = Readonly<z.infer<typeof environmentSchema>>;

export class EnvironmentValidationError extends Error {
  public readonly issues: string[];

  public constructor(issues: string[]) {
    super(`Environment validation failed: ${issues.join("; ")}`);
    this.name = "EnvironmentValidationError";
    this.issues = issues;
  }
}

function sanitizeIssueMessage(issue: z.ZodIssue): string {
  const path = issue.path.join(".") || "environment";
  return `${path}: ${issue.message}`;
}

export function parseEnvironmentConfig(environment: NodeJS.ProcessEnv): EnvironmentConfig {
  const parsedEnvironment = environmentSchema.safeParse(environment);

  if (!parsedEnvironment.success) {
    throw new EnvironmentValidationError(parsedEnvironment.error.issues.map(sanitizeIssueMessage));
  }

  return Object.freeze(parsedEnvironment.data);
}

loadLocalEnvironmentFile();

export const environmentConfig = parseEnvironmentConfig(process.env);
