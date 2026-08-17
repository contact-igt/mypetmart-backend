import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

import { z } from "zod";

const SECRET_FIELD_NAMES = [
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "AUTH_OTP_HMAC_SECRET",
  "SMTP_PASS",
  "R2_SECRET_ACCESS_KEY",
  "R2_UPLOAD_INTENT_SECRET",
  "PAYMENT_KEY_SECRET",
  "PAYMENT_WEBHOOK_SECRET",
  "SHIPPING_API_KEY",
  "SHIPPING_WEBHOOK_SECRET",
  "DB_PASSWORD"
] as const;

const PLACEHOLDER_VALUES = new Set([
  "replace_with_a_long_random_secret",
  "replace_with_a_different_long_random_secret",
  "replace_with_r2_access_key_id",
  "replace_with_r2_secret_access_key",
  "replace_with_a_long_random_r2_upload_intent_secret"
]);

const R2_REQUIRED_FIELDS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "R2_UPLOAD_INTENT_SECRET"
] as const;

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

function requiredStringWithMinLength(name: string, minLength: number) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string({ error: `${name} is required.` }).min(minLength, `${name} must be at least ${minLength} characters.`)
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

    PRODUCTION_DB_HOST: optionalTrimmedStringSchema,
    PRODUCTION_DB_PORT: integerFromString("PRODUCTION_DB_PORT", 1, 65535).optional(),
    PRODUCTION_DB_NAME: optionalTrimmedStringSchema,
    PRODUCTION_DB_USER: optionalTrimmedStringSchema,
    PRODUCTION_DB_PASSWORD: z.preprocess(optionalString, z.string().optional()),
    PRODUCT_SAFE_TRASH_CUTOFF: z.preprocess(
      optionalString,
      z.iso.datetime({ offset: true, message: "PRODUCT_SAFE_TRASH_CUTOFF must be an ISO-8601 timestamp." }).optional()
    ),

    JWT_ACCESS_SECRET: requiredStringWithMinLength("JWT_ACCESS_SECRET", 32),
    JWT_REFRESH_SECRET: requiredStringWithMinLength("JWT_REFRESH_SECRET", 32),
    JWT_ACCESS_EXPIRES_IN: requiredString("JWT_ACCESS_EXPIRES_IN").default("15m"),
    JWT_REFRESH_EXPIRES_IN: requiredString("JWT_REFRESH_EXPIRES_IN").default("30d"),
    JWT_ISSUER: requiredString("JWT_ISSUER").default("mypetmart-backend"),
    JWT_CUSTOMER_AUDIENCE: requiredString("JWT_CUSTOMER_AUDIENCE").default("mypetmart-storefront"),
    JWT_ADMIN_AUDIENCE: requiredString("JWT_ADMIN_AUDIENCE").default("mypetmart-admin"),
    CUSTOMER_REFRESH_COOKIE_NAME: requiredString("CUSTOMER_REFRESH_COOKIE_NAME").default("mypetmart_customer_refresh"),
    ADMIN_REFRESH_COOKIE_NAME: requiredString("ADMIN_REFRESH_COOKIE_NAME").default("mypetmart_admin_refresh"),
    AUTH_RATE_LIMIT_WINDOW_MS: integerFromString("AUTH_RATE_LIMIT_WINDOW_MS", 1, 24 * 60 * 60 * 1000).default(900000),
    AUTH_RATE_LIMIT_MAX: integerFromString("AUTH_RATE_LIMIT_MAX", 1, 10000).default(20),

    AUTH_OTP_HMAC_SECRET: requiredStringWithMinLength("AUTH_OTP_HMAC_SECRET", 32).default("c4d9a6e1f3b2a8d5c7e9f1a3b5c7d9e1f3a5b7c9d1e3f5a7b9c1d3e5f7a9b1c3"),
    AUTH_OTP_TTL_SECONDS: integerFromString("AUTH_OTP_TTL_SECONDS", 60, 86400).default(600),
    AUTH_OTP_MAX_ATTEMPTS: integerFromString("AUTH_OTP_MAX_ATTEMPTS", 1, 50).default(5),
    AUTH_OTP_RESEND_COOLDOWN_SECONDS: integerFromString("AUTH_OTP_RESEND_COOLDOWN_SECONDS", 0, 3600).default(60),

    PASSWORD_RESET_TOKEN_TTL_SECONDS: integerFromString("PASSWORD_RESET_TOKEN_TTL_SECONDS", 60, 86400).default(900),
    PASSWORD_RESET_COOKIE_NAME: requiredString("PASSWORD_RESET_COOKIE_NAME").default("mypetmart_password_reset"),

    CART_GUEST_COOKIE_NAME: requiredString("CART_GUEST_COOKIE_NAME").default("mypetmart_guest_cart"),

    SMTP_HOST: optionalTrimmedStringSchema,
    SMTP_PORT: integerFromString("SMTP_PORT", 1, 65535).default(587),
    SMTP_SECURE: booleanFromString("SMTP_SECURE").default(false),
    SMTP_USER: optionalTrimmedStringSchema,
    SMTP_PASS: optionalTrimmedStringSchema,
    MAIL_FROM_NAME: requiredString("MAIL_FROM_NAME").default("MyPetMart"),
    MAIL_FROM_EMAIL: requiredString("MAIL_FROM_EMAIL").default("noreply@mypetmart.com"),

    R2_ACCOUNT_ID: optionalTrimmedStringSchema,
    R2_ACCESS_KEY_ID: optionalTrimmedStringSchema,
    R2_SECRET_ACCESS_KEY: optionalTrimmedStringSchema,
    R2_BUCKET: optionalTrimmedStringSchema,
    R2_PUBLIC_BASE_URL: z.preprocess(optionalString, z.url("R2_PUBLIC_BASE_URL must be a valid URL.").optional()),
    R2_UPLOAD_INTENT_SECRET: z.preprocess(
      optionalString,
      z.string().min(32, "R2_UPLOAD_INTENT_SECRET must be at least 32 characters.").optional()
    ),
    R2_UPLOAD_URL_EXPIRY_SECONDS: integerFromString("R2_UPLOAD_URL_EXPIRY_SECONDS", 60, 900).default(300),
    R2_MAX_IMAGE_SIZE_BYTES: integerFromString("R2_MAX_IMAGE_SIZE_BYTES", 1, 5 * 1024 * 1024).default(5 * 1024 * 1024),
    R2_ORPHAN_GRACE_HOURS: integerFromString("R2_ORPHAN_GRACE_HOURS", 1, 168).default(24),

    PAYMENT_PROVIDER: optionalTrimmedStringSchema,
    PAYMENT_KEY_ID: optionalTrimmedStringSchema,
    PAYMENT_KEY_SECRET: optionalTrimmedStringSchema,
    PAYMENT_WEBHOOK_SECRET: optionalTrimmedStringSchema,
    // PayU Hosted Checkout form-post endpoint. Optional — payment.config.ts
    // falls back to PayU's published test/live URL by NODE_ENV when unset.
    PAYMENT_GATEWAY_URL: z.preprocess(optionalString, z.url("PAYMENT_GATEWAY_URL must be a valid URL.").optional()),

    SHIPPING_PROVIDER: optionalTrimmedStringSchema,
    SHIPPING_API_KEY: optionalTrimmedStringSchema,
    SHIPPING_WEBHOOK_SECRET: optionalTrimmedStringSchema
  })
  .superRefine((value, context) => {
    if (value.NODE_ENV === "production" && !value.PRODUCT_SAFE_TRASH_CUTOFF) {
      context.addIssue({
        code: "custom",
        path: ["PRODUCT_SAFE_TRASH_CUTOFF"],
        message: "PRODUCT_SAFE_TRASH_CUTOFF is required in production. Set it to the safe parent-only trash rollout timestamp."
      });
    }
    if (value.DB_POOL_MIN > value.DB_POOL_MAX) {
      context.addIssue({
        code: "custom",
        path: ["DB_POOL_MIN"],
        message: "DB_POOL_MIN must be less than or equal to DB_POOL_MAX."
      });
    }

    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_SECRET"],
        message: "JWT_REFRESH_SECRET must be different from JWT_ACCESS_SECRET."
      });
    }

    const configuredR2Fields = R2_REQUIRED_FIELDS.filter((fieldName) => value[fieldName] !== undefined);
    if (configuredR2Fields.length > 0 && configuredR2Fields.length < R2_REQUIRED_FIELDS.length) {
      for (const fieldName of R2_REQUIRED_FIELDS) {
        if (value[fieldName] === undefined) {
          context.addIssue({
            code: "custom",
            path: [fieldName],
            message: `${fieldName} is required when Cloudflare R2 is configured.`
          });
        }
      }
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
