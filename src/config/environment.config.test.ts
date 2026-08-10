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

  it("allows future R2/payment/shipping integration settings to remain optional", () => {
    const config = parseEnvironmentConfig(
      createValidEnvironment({
        R2_SECRET_ACCESS_KEY: "",
        PAYMENT_KEY_SECRET: "",
        SHIPPING_API_KEY: ""
      })
    );

    expect(config.R2_SECRET_ACCESS_KEY).toBeUndefined();
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
