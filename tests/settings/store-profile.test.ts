/* eslint-disable */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { User, AuthSession } from "../../src/database/tables/index.js";
import { StoreSetting } from "../../src/database/tables/StoreSettingTable/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

const STORE_PROFILE = {
  storeName: "Store Profile Test Mart",
  supportEmail: "store-profile-test@example.com",
  supportPhone: "+91 90000 00001",
  address: "1 StoreProfile Test Street, Chennai"
};

describe("StoreProfile — public storefront read (real-data)", () => {
  let superAdminToken = "";

  beforeAll(async () => {
    await connectDatabase();

    const email = "store-profile-test-super-admin@example.com";
    const existing = await User.findOne({ where: { email }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }

    const superAdmin = await User.create({
      id: 99401,
      name: "Store Profile Super Admin",
      email,
      password_hash: await PasswordService.hash("TestPass123!@#"),
      role: "super_admin",
      status: "active",
      reference_code: "SUP-099401"
    });
    const { session } = await SessionService.createSession(superAdmin.id, "admin", null, null);
    superAdminToken = TokenService.generateAccessToken({
      sub: String(superAdmin.id),
      sessionId: String(session.id),
      role: "super_admin",
      sessionType: "admin"
    });

    // Deterministic fixture — same upsert path SettingsService.updateStoreProfile
    // itself uses, keyed the same way the real Admin Settings save does.
    await StoreSetting.upsert({
      setting_key: "store_profile",
      setting_value: STORE_PROFILE,
      is_public: true
    });
  });

  afterAll(async () => {
    const email = "store-profile-test-super-admin@example.com";
    const existing = await User.findOne({ where: { email }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    await disconnectDatabase();
  });

  describe("GET /storefront/store-profile", () => {
    it("returns 200 with no Authorization header", async () => {
      const res = await request(app).get("/api/v1/storefront/store-profile");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns the real supportEmail, supportPhone and address", async () => {
      const res = await request(app).get("/api/v1/storefront/store-profile");
      expect(res.body.data.supportEmail).toBe(STORE_PROFILE.supportEmail);
      expect(res.body.data.supportPhone).toBe(STORE_PROFILE.supportPhone);
      expect(res.body.data.address).toBe(STORE_PROFILE.address);
      expect(res.body.data.storeName).toBe(STORE_PROFILE.storeName);
    });

    it("exposes exactly the 4 public-safe fields — nothing else", async () => {
      const res = await request(app).get("/api/v1/storefront/store-profile");
      expect(Object.keys(res.body.data).sort()).toEqual(["address", "storeName", "supportEmail", "supportPhone"]);
    });

    it("does not require an Authorization header even when one is present but invalid", async () => {
      // A garbage token must not turn into a 401 — this route never checks auth at all.
      const res = await request(app).get("/api/v1/storefront/store-profile").set("Authorization", "Bearer not-a-real-token");
      expect(res.status).toBe(200);
    });
  });

  describe("GET /admin/settings/store — unchanged by this change", () => {
    it("still requires authentication", async () => {
      const res = await request(app).get("/api/v1/admin/settings/store");
      expect(res.status).toBe(401);
    });

    it("still returns the full StoreProfile to a super_admin", async () => {
      const res = await request(app).get("/api/v1/admin/settings/store").set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual(STORE_PROFILE);
    });
  });
});
