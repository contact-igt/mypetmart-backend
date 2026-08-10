import { describe, expect, it } from "vitest";

import { parseSeedConfig } from "../../src/config/seed.config.js";
import { isBcryptHash } from "../../src/database/seeders/index.js";

const validEnv = {
  SEED_SUPER_ADMIN_NAME: " Bootstrap Admin ",
  SEED_SUPER_ADMIN_EMAIL: "Bootstrap.Admin@Example.COM ",
  SEED_SUPER_ADMIN_PHONE: " 9999999999 ",
  SEED_SUPER_ADMIN_PASSWORD: "StrongPass#123",
  SEED_SUPER_ADMIN_BCRYPT_ROUNDS: "12",
  ALLOW_PRODUCTION_SEED: "false"
};

describe("bootstrap super-admin seed configuration", () => {
  it("trims administrator fields and normalizes email", () => {
    const config = parseSeedConfig(validEnv);
    expect(config.SEED_SUPER_ADMIN_NAME).toBe("Bootstrap Admin");
    expect(config.SEED_SUPER_ADMIN_EMAIL).toBe("bootstrap.admin@example.com");
    expect(config.SEED_SUPER_ADMIN_PHONE).toBe("9999999999");
  });

  it("requires strong privileged bootstrap passwords", () => {
    for (const password of ["short", "lowercaseonly123!", "UPPERCASEONLY123!", "NoNumber!!!!", "NoSpecial1234"]) {
      expect(() => parseSeedConfig({ ...validEnv, SEED_SUPER_ADMIN_PASSWORD: password })).toThrow(/SEED_SUPER_ADMIN_PASSWORD/u);
    }
  });

  it("detects bcrypt-formatted hashes without exposing hash content", () => {
    const fakeBcryptFormat = ["$2b", "12", "abcdefghijklmnopqrstuu3xwrnWv5eK1uF2Jp8G.2u2YxE.E5x.S"].join("$");
    expect(isBcryptHash(fakeBcryptFormat)).toBe(true);
    expect(isBcryptHash("StrongPass#123")).toBe(false);
  });

  it("reports missing seed fields safely", () => {
    expect(() => parseSeedConfig({ ...validEnv, SEED_SUPER_ADMIN_NAME: "" })).toThrow(/SEED_SUPER_ADMIN_NAME/u);
    expect(() => parseSeedConfig({ ...validEnv, SEED_SUPER_ADMIN_PASSWORD: "" })).toThrow(/SEED_SUPER_ADMIN_PASSWORD/u);
  });
});
