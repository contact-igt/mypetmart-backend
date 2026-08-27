import { describe, expect, it } from "vitest";

import { EnvironmentValidationError, parseEnvironmentConfig } from "./environment.config.js";

type TestEnvironment = NodeJS.ProcessEnv;

function createValidEnvironment(overrides: TestEnvironment = {}): TestEnvironment {
  return {
    NODE_ENV: "development",
    PORT: "5000",
    LOG_LEVEL: "info",
    REQUEST_BODY_LIMIT: "1mb",
    STOREFRONT_ORIGIN: "http://localhost:3000",
    ADMIN_ORIGIN: "http://localhost:4000",
    DB_HOST: "127.0.0.1",
    DB_PORT: "3306",
    DB_NAME: "mypetmart",
    DB_USER: "root",
    DB_PASSWORD: "",
    DB_LOGGING: "false",
    DB_POOL_MAX: "10",
    DB_POOL_MIN: "0",
    DB_POOL_ACQUIRE_MS: "30000",
    DB_POOL_IDLE_MS: "10000",
    JWT_ACCESS_SECRET: "access_secret_should_be_at_least_32_characters_long",
    JWT_REFRESH_SECRET: "refresh_secret_should_be_at_least_32_characters_long",
    ...overrides
  };
}

describe("environment configuration", () => {
  it("parses a valid configuration", () => {
    const config = parseEnvironmentConfig(createValidEnvironment());

    expect(config.PORT).toBe(5000);
    expect(config.DB_PORT).toBe(3306);
    expect(config.DB_NAME).toBe("mypetmart");
    expect(config.DB_LOGGING).toBe(false);
    expect(config.DB_POOL_MAX).toBe(10);
    expect(config.SHIPMENT_NUMBER_PREFIX).toBe("TEST-SHP");
  });

  it("loads an explicit shipment number prefix", () => {
    expect(parseEnvironmentConfig(createValidEnvironment({ SHIPMENT_NUMBER_PREFIX: "SHP" })).SHIPMENT_NUMBER_PREFIX).toBe("SHP");
  });

  it.each(["", "test-shp", "TEST SHP", "TEST/SHP", "TEST--SHP", "A".repeat(25)])("rejects unsafe shipment number prefix %j", (prefix) => {
    expect(() => parseEnvironmentConfig(createValidEnvironment({ SHIPMENT_NUMBER_PREFIX: prefix }))).toThrow(EnvironmentValidationError);
  });

  it("requires an explicit shipment number prefix in production", () => {
    expect(() => parseEnvironmentConfig(createValidEnvironment({ NODE_ENV: "production", PRODUCT_SAFE_TRASH_CUTOFF: "2026-08-11T14:00:00.000Z" }))).toThrow(
      /SHIPMENT_NUMBER_PREFIX is required/u
    );
  });

  it("accepts the production shipment number prefix", () => {
    const config = parseEnvironmentConfig(createValidEnvironment({ NODE_ENV: "production", PRODUCT_SAFE_TRASH_CUTOFF: "2026-08-11T14:00:00.000Z", SHIPMENT_NUMBER_PREFIX: "SHP" }));
    expect(config.SHIPMENT_NUMBER_PREFIX).toBe("SHP");
  });

  it("fails when a required database variable is missing", () => {
    const environment = createValidEnvironment();
    delete environment.DB_HOST;

    expect(() => parseEnvironmentConfig(environment)).toThrow(EnvironmentValidationError);
  });

  it("rejects an invalid application port", () => {
    expect(() => parseEnvironmentConfig(createValidEnvironment({ PORT: "70000" }))).toThrow(EnvironmentValidationError);
  });

  it("rejects invalid pool settings", () => {
    expect(() => parseEnvironmentConfig(createValidEnvironment({ DB_POOL_MIN: "11", DB_POOL_MAX: "10" }))).toThrow(
      EnvironmentValidationError
    );
  });

  it("converts boolean strings explicitly", () => {
    const config = parseEnvironmentConfig(createValidEnvironment({ DB_LOGGING: "true" }));

    expect(config.DB_LOGGING).toBe(true);
  });

  it("allows R2 to remain explicitly not configured", () => {
    const config = parseEnvironmentConfig(
      createValidEnvironment({
        R2_SECRET_ACCESS_KEY: "",
        PAYMENT_KEY_SECRET: "",
        SHIPPING_API_KEY: ""
      })
    );

    expect(config.R2_SECRET_ACCESS_KEY).toBeUndefined();
    expect(config.R2_UPLOAD_URL_EXPIRY_SECONDS).toBe(300);
    expect(config.R2_MAX_IMAGE_SIZE_BYTES).toBe(5 * 1024 * 1024);
  });

  it("requires a complete coherent R2 configuration when any R2 credential is present", () => {
    expect(() => parseEnvironmentConfig(createValidEnvironment({ R2_ACCOUNT_ID: "account-only" }))).toThrow(EnvironmentValidationError);
  });

  it("accepts a complete R2 configuration and bounded upload policy", () => {
    const config = parseEnvironmentConfig(
      createValidEnvironment({
        R2_ACCOUNT_ID: "account-id",
        R2_ACCESS_KEY_ID: "access-key-id",
        R2_SECRET_ACCESS_KEY: "secret-access-key",
        R2_BUCKET: "mypetmart-images",
        R2_PUBLIC_BASE_URL: "https://images.mypetmart.test",
        R2_UPLOAD_INTENT_SECRET: "r2_intent_secret_that_is_at_least_thirty_two_chars",
        R2_UPLOAD_URL_EXPIRY_SECONDS: "120",
        R2_MAX_IMAGE_SIZE_BYTES: "5000000"
      })
    );
    expect(config.R2_UPLOAD_URL_EXPIRY_SECONDS).toBe(120);
    expect(config.R2_MAX_IMAGE_SIZE_BYTES).toBe(5_000_000);
  });

  it("loads and preserves the iThink Store ID from environment configuration", () => {
    const config = parseEnvironmentConfig(
      createValidEnvironment({
        ITHINK_ACCESS_TOKEN: "test-access-token",
        ITHINK_SECRET_KEY: "test-secret-key",
        ITHINK_STORE_ID: "27377",
        ITHINK_PICKUP_ADDRESS_ID: "108362",
        ITHINK_RETURN_ADDRESS_ID: "108362",
        ITHINK_ORIGIN_PINCODE: "600077"
      })
    );

    expect(config.ITHINK_STORE_ID).toBe("27377");
    expect(config.ITHINK_PICKUP_ADDRESS_ID).toBe("108362");
  });

  it("requires Store ID when iThink Logistics is configured", () => {
    expect(() =>
      parseEnvironmentConfig(
        createValidEnvironment({
          ITHINK_ACCESS_TOKEN: "test-access-token",
          ITHINK_SECRET_KEY: "test-secret-key",
          ITHINK_PICKUP_ADDRESS_ID: "108362",
          ITHINK_RETURN_ADDRESS_ID: "108362",
          ITHINK_ORIGIN_PINCODE: "600077"
        })
      )
    ).toThrow(EnvironmentValidationError);

    try {
      parseEnvironmentConfig(
        createValidEnvironment({
          ITHINK_ACCESS_TOKEN: "test-access-token",
          ITHINK_SECRET_KEY: "test-secret-key",
          ITHINK_PICKUP_ADDRESS_ID: "108362",
          ITHINK_RETURN_ADDRESS_ID: "108362",
          ITHINK_ORIGIN_PINCODE: "600077"
        })
      );
    } catch (error) {
      expect(String(error)).toContain("ITHINK_STORE_ID is required when iThink Logistics is configured.");
      expect(String(error)).not.toContain("test-secret-key");
      expect(String(error)).not.toContain("test-access-token");
    }
  });

  it("rejects a Product image policy above the 5 MiB Admin contract", () => {
    expect(() => parseEnvironmentConfig(createValidEnvironment({ R2_MAX_IMAGE_SIZE_BYTES: String(5 * 1024 * 1024 + 1) }))).toThrow(
      EnvironmentValidationError
    );
  });

  it("requires an explicit safe Product trash rollout cutoff in production", () => {
    expect(() => parseEnvironmentConfig(createValidEnvironment({ NODE_ENV: "production", SHIPMENT_NUMBER_PREFIX: "SHP" }))).toThrow(EnvironmentValidationError);
  });

  it("accepts and preserves an ISO Product trash rollout cutoff", () => {
    const cutoff = "2026-08-11T14:00:00.000Z";
    const config = parseEnvironmentConfig(createValidEnvironment({ NODE_ENV: "production", PRODUCT_SAFE_TRASH_CUTOFF: cutoff, SHIPMENT_NUMBER_PREFIX: "SHP" }));

    expect(config.PRODUCT_SAFE_TRASH_CUTOFF).toBe(cutoff);
  });

  it("rejects production R2 placeholder secrets without echoing their values", () => {
    const environment = createValidEnvironment({
      NODE_ENV: "production",
      SHIPMENT_NUMBER_PREFIX: "SHP",
      R2_ACCOUNT_ID: "account-id",
      R2_ACCESS_KEY_ID: "replace_with_r2_access_key_id",
      R2_SECRET_ACCESS_KEY: "replace_with_r2_secret_access_key",
      R2_BUCKET: "mypetmart-images",
      R2_PUBLIC_BASE_URL: "https://images.mypetmart.test",
      R2_UPLOAD_INTENT_SECRET: "replace_with_a_long_random_r2_upload_intent_secret"
    });
    expect(() => parseEnvironmentConfig(environment)).toThrow(EnvironmentValidationError);
    try {
      parseEnvironmentConfig(environment);
    } catch (error) {
      expect(String(error)).not.toContain("replace_with_r2_secret_access_key");
    }
  });

  it("rejects identical JWT secrets", () => {
    expect(() =>
      parseEnvironmentConfig(
        createValidEnvironment({
          JWT_ACCESS_SECRET: "identical_secret_of_sufficient_length_here_123",
          JWT_REFRESH_SECRET: "identical_secret_of_sufficient_length_here_123"
        })
      )
    ).toThrow(EnvironmentValidationError);
  });

  it("does not include secret values in validation error output", () => {
    const secretValue = "this_secret_must_not_be_echoed_at_all_123456789";

    expect(() => parseEnvironmentConfig(createValidEnvironment({ PORT: "invalid", JWT_ACCESS_SECRET: secretValue }))).toThrow(
      EnvironmentValidationError
    );

    try {
      parseEnvironmentConfig(createValidEnvironment({ PORT: "invalid", JWT_ACCESS_SECRET: secretValue }));
    } catch (error) {
      expect(String(error)).not.toContain(secretValue);
    }
  });
});
