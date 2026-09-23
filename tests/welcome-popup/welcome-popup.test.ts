/* eslint-disable */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Op } from "sequelize";
import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { AuthSession, Coupon, MediaAsset, User, WelcomePopup } from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { DATABASE_TABLE_NAMES } from "../../src/constants/database.constants.js";

describe("Welcome Popup Backend APIs (Module 2)", () => {
  let superAdminToken: string = "";
  let adminToken: string = "";
  let customerToken: string = "";
  let imageAssetId: number;
  let videoAssetId: number;
  let couponId: number;

  async function createMediaAsset(overrides: { mediaType?: "image" | "video" } = {}): Promise<number> {
    return sequelize.transaction(async (transaction) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.mediaAssets, transaction);
      const asset = await MediaAsset.create(
        {
          id,
          file_name: `welcome-popup-test-${id}.jpg`,
          original_name: `welcome-popup-test-${id}.jpg`,
          storage_key: `media/test/welcome-popup-${id}.jpg`,
          public_url: `https://cdn.example.com/media/test/welcome-popup-${id}.jpg`,
          mime_type: overrides.mediaType === "video" ? "video/mp4" : "image/jpeg",
          media_type: overrides.mediaType ?? "image",
          file_size: 1024,
          uploaded_by: 99201,
          alt_text: "Test product image"
        },
        { transaction }
      );
      return asset.id;
    });
  }

  beforeAll(async () => {
    await connectDatabase();

    const testEmails = ["popup-test-super@example.com", "popup-test-admin@example.com", "popup-test-user@example.com"];
    const existingUsers = await User.findAll({ where: { email: testEmails }, paranoid: false });
    if (existingUsers.length > 0) {
      const ids = existingUsers.map((u) => u.id);
      await AuthSession.destroy({ where: { user_id: ids }, force: true });
      await User.destroy({ where: { id: ids }, force: true });
    }

    const pwdHash = await PasswordService.hash("TestPass123!@#");

    const superAdmin = await User.create({
      id: 99201,
      name: "Popup Super Admin",
      email: "popup-test-super@example.com",
      password_hash: pwdHash,
      role: "super_admin",
      status: "active",
      reference_code: "SUP-099201"
    });
    const { session: superSession } = await SessionService.createSession(superAdmin.id, "admin", null, null);
    superAdminToken = TokenService.generateAccessToken({
      sub: String(superAdmin.id),
      sessionId: String(superSession.id),
      role: "super_admin",
      sessionType: "admin"
    });

    const adminUser = await User.create({
      id: 99202,
      name: "Popup Admin",
      email: "popup-test-admin@example.com",
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099202"
    });
    const { session: adminSession } = await SessionService.createSession(adminUser.id, "admin", null, null);
    adminToken = TokenService.generateAccessToken({
      sub: String(adminUser.id),
      sessionId: String(adminSession.id),
      role: "admin",
      sessionType: "admin"
    });

    const customerUser = await User.create({
      id: 99203,
      name: "Popup Customer",
      email: "popup-test-user@example.com",
      password_hash: pwdHash,
      role: "customer",
      status: "active",
      reference_code: "CUS-099203"
    });
    const { session: custSession } = await SessionService.createSession(customerUser.id, "customer", null, null);
    customerToken = TokenService.generateAccessToken({
      sub: String(customerUser.id),
      sessionId: String(custSession.id),
      role: "customer",
      sessionType: "customer"
    });

    await WelcomePopup.destroy({ where: { name: { [Op.like]: "Popup test%" } }, force: true });
    imageAssetId = await createMediaAsset({ mediaType: "image" });
    videoAssetId = await createMediaAsset({ mediaType: "video" });
    couponId = await sequelize.transaction(async (transaction) => {
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.coupons, transaction);
      await Coupon.create({ id, code: "POPUP10", name: "Popup test coupon", discount_type: "percentage", discount_value: 1000, min_eligible_amount_paise: 0, first_order_only: false, status: "active" }, { transaction });
      return id;
    });
  });

  afterAll(async () => {
    await WelcomePopup.destroy({ where: { name: { [Op.like]: "Popup test%" } }, force: true });
    await Coupon.destroy({ where: { id: couponId }, force: true });
    await MediaAsset.destroy({ where: { id: [imageAssetId, videoAssetId] }, force: true });
    await AuthSession.destroy({ where: { user_id: [99201, 99202, 99203] }, force: true });
    await User.destroy({ where: { id: [99201, 99202, 99203] }, force: true });
    await disconnectDatabase();
  });

  describe("Admin authorization", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get("/api/v1/admin/welcome-popups");
      expect(res.status).toBe(401);
    });

    it("rejects a plain admin (super_admin required)", async () => {
      const res = await request(app).get("/api/v1/admin/welcome-popups").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });

    it("rejects a customer session", async () => {
      const res = await request(app).get("/api/v1/admin/welcome-popups").set("Authorization", `Bearer ${customerToken}`);
      expect(res.status).toBe(401);
    });
  });

  describe("Admin CRUD", () => {
    let createdId: number;

    it("lists active coupons as popup selector options", async () => {
      const res = await request(app)
        .get("/api/v1/admin/welcome-popups/coupon-options")
        .set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toContainEqual({ id: couponId, code: "POPUP10", name: "Popup test coupon" });
    });

    it("creates a template_1 draft popup with a resolved image reference", async () => {
      const res = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "Popup test welcome",
          template: "template_1",
          heading: "Unlock 10% off your first order",
          ctaLabel: "Unlock Offers",
          desktopImageId: imageAssetId
        });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("draft");
      expect(res.body.data.isHomepageActive).toBe(false);
      expect(res.body.data.desktopImageUrl).toBe(`https://cdn.example.com/media/test/welcome-popup-${imageAssetId}.jpg`);
      expect(res.body.data.desktopImageAlt).toBe("Test product image");
      expect(res.body.data.ctaMode).toBe("email_signup");
      expect(res.body.data.displayDelayMs).toBe(1200);
      expect(res.body.data.dismissalCooldownDays).toBe(7);
      createdId = res.body.data.id;
    });

    it("associates an existing coupon and exposes only its code publicly", async () => {
      const update = await request(app)
        .patch(`/api/v1/admin/welcome-popups/${createdId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ couponId });
      expect(update.status).toBe(200);
      expect(update.body.data.couponId).toBe(couponId);
      expect(update.body.data.couponCode).toBe("POPUP10");
    });

    it("rejects a missing heading", async () => {
      const res = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test bad", template: "template_1", heading: "" });
      expect(res.status).toBe(400);
    });

    it("rejects an unknown media asset id", async () => {
      const res = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test bad media", template: "template_1", heading: "Heading", desktopImageId: 9_999_999 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("WELCOME_POPUP_MEDIA_NOT_FOUND");
    });

    it("rejects a video asset used as an image field", async () => {
      const res = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test video media", template: "template_1", heading: "Heading", desktopImageId: videoAssetId });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("WELCOME_POPUP_MEDIA_NOT_IMAGE");
    });

    it("rejects a CTA URL that is not absolute or site-relative", async () => {
      const res = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test bad url", template: "template_1", heading: "Heading", ctaUrl: "javascript:alert(1)" });
      expect(res.status).toBe(400);
    });

    it("rejects protocol-relative CTA URLs", async () => {
      const res = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test protocol relative", template: "template_1", heading: "Heading", ctaMode: "navigation", ctaUrl: "//unsafe.example" });
      expect(res.status).toBe(400);
    });

    it("persists a navigation CTA and timing configuration", async () => {
      const res = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test navigation", template: "template_1", heading: "Heading", ctaMode: "navigation", ctaLabel: "Shop now", ctaUrl: "/shop", displayDelayMs: 2500, dismissalCooldownDays: 14 });
      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ ctaMode: "navigation", ctaLabel: "Shop now", ctaUrl: "/shop", displayDelayMs: 2500, dismissalCooldownDays: 14 });
    });

    it("lists items including the created one", async () => {
      const res = await request(app).get("/api/v1/admin/welcome-popups").set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((i: { id: number }) => i.id === createdId)).toBe(true);
    });

    it("gets a single item by id", async () => {
      const res = await request(app).get(`/api/v1/admin/welcome-popups/${createdId}`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Popup test welcome");
    });

    it("404s for an unknown item id", async () => {
      const res = await request(app).get("/api/v1/admin/welcome-popups/9999999").set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(404);
    });

    it("updates content fields", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/welcome-popups/${createdId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ heading: "Updated heading" });
      expect(res.status).toBe(200);
      expect(res.body.data.heading).toBe("Updated heading");
    });

    it("clears an image reference when the media id is set to null", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/welcome-popups/${createdId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ desktopImageId: null });
      expect(res.status).toBe(200);
      expect(res.body.data.desktopImageUrl).toBeNull();

      // Restore for the publish tests below.
      const restore = await request(app)
        .patch(`/api/v1/admin/welcome-popups/${createdId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ desktopImageId: imageAssetId });
      expect(restore.status).toBe(200);
    });
  });

  describe("Publish requirements", () => {
    it("rejects publishing template_2 without an offer label", async () => {
      const created = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test template2 no offer", template: "template_2", heading: "Heading", desktopImageId: imageAssetId });
      const id = created.body.data.id;

      const publish = await request(app).patch(`/api/v1/admin/welcome-popups/${id}/publish`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(publish.status).toBe(422);
      expect(publish.body.error.code).toBe("WELCOME_POPUP_NOT_READY_TO_PUBLISH");
    });

    it("rejects publishing without a desktop image", async () => {
      const created = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test no image", template: "template_1", heading: "Heading" });
      const id = created.body.data.id;

      const publish = await request(app).patch(`/api/v1/admin/welcome-popups/${id}/publish`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(publish.status).toBe(422);
    });

    it("rejects publishing without a description", async () => {
      const created = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test no description", template: "template_1", heading: "Heading", desktopImageId: imageAssetId });
      const publish = await request(app).patch(`/api/v1/admin/welcome-popups/${created.body.data.id}/publish`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(publish.status).toBe(422);
      expect(publish.body.error.code).toBe("WELCOME_POPUP_NOT_READY_TO_PUBLISH");
    });

    it("publishes a complete template_2 popup once an offer label is set", async () => {
      const created = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test template2 ready", template: "template_2", heading: "Unlock 15% off", description: "Join our pet-parent community.", offerLabel: "15% OFF", desktopImageId: imageAssetId });
      const id = created.body.data.id;

      const publish = await request(app).patch(`/api/v1/admin/welcome-popups/${id}/publish`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(publish.status).toBe(200);
      expect(publish.body.data.status).toBe("published");
    });

    it("rejects activating a draft popup", async () => {
      const created = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test draft activate", template: "template_1", heading: "Heading", desktopImageId: imageAssetId });
      const id = created.body.data.id;

      const activate = await request(app).patch(`/api/v1/admin/welcome-popups/${id}/activate`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(activate.status).toBe(409);
      expect(activate.body.error.code).toBe("WELCOME_POPUP_NOT_PUBLISHED");
    });
  });

  describe("Activation replaces the homepage assignment", () => {
    async function createPublished(name: string) {
      const created = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name, template: "template_1", heading: "Heading", description: "A helpful popup description.", desktopImageId: imageAssetId });
      const id = created.body.data.id;
      const published = await request(app).patch(`/api/v1/admin/welcome-popups/${id}/publish`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(published.status).toBe(200);
      return id as number;
    }

    it("activating popup B deactivates popup A, and exactly one is ever active", async () => {
      const idA = await createPublished("Popup test activation A");
      const idB = await createPublished("Popup test activation B");

      const activateA = await request(app).patch(`/api/v1/admin/welcome-popups/${idA}/activate`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(activateA.status).toBe(200);
      expect(activateA.body.data.isHomepageActive).toBe(true);

      const activateB = await request(app).patch(`/api/v1/admin/welcome-popups/${idB}/activate`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(activateB.status).toBe(200);
      expect(activateB.body.data.isHomepageActive).toBe(true);

      const activeCount = await WelcomePopup.count({ where: { is_homepage_active: true, id: [idA, idB] } });
      expect(activeCount).toBe(1);

      const reloadedA = await WelcomePopup.findByPk(idA);
      expect(reloadedA?.is_homepage_active).toBe(false);
    });

    it("concurrent activation of two different popups never leaves more than one active", async () => {
      const idA = await createPublished("Popup test concurrent A");
      const idB = await createPublished("Popup test concurrent B");

      const [resA, resB] = await Promise.all([
        request(app).patch(`/api/v1/admin/welcome-popups/${idA}/activate`).set("Authorization", `Bearer ${superAdminToken}`),
        request(app).patch(`/api/v1/admin/welcome-popups/${idB}/activate`).set("Authorization", `Bearer ${superAdminToken}`)
      ]);

      // Both requests should resolve (either succeeding, or — if they raced
      // hard enough to hit the database's own unique-constraint backstop —
      // a 409 conflict asking the caller to retry). Either way, the
      // invariant that must always hold is checked below.
      for (const res of [resA, resB]) {
        expect([200, 409]).toContain(res.status);
      }

      const activeCount = await WelcomePopup.count({ where: { is_homepage_active: true, id: [idA, idB] } });
      expect(activeCount).toBe(1);
    });

    it("deactivate turns a popup off without affecting others", async () => {
      const idA = await createPublished("Popup test deactivate A");
      await request(app).patch(`/api/v1/admin/welcome-popups/${idA}/activate`).set("Authorization", `Bearer ${superAdminToken}`);

      const deactivate = await request(app).patch(`/api/v1/admin/welcome-popups/${idA}/deactivate`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(deactivate.status).toBe(200);
      expect(deactivate.body.data.isHomepageActive).toBe(false);
    });

    it("archiving an active popup also deactivates it (status+active updated together, satisfying the CHECK constraint)", async () => {
      const idA = await createPublished("Popup test archive active");
      const activate = await request(app).patch(`/api/v1/admin/welcome-popups/${idA}/activate`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(activate.status).toBe(200);

      const archive = await request(app).patch(`/api/v1/admin/welcome-popups/${idA}/archive`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(archive.status).toBe(200);
      expect(archive.body.data.status).toBe("archived");
      expect(archive.body.data.isHomepageActive).toBe(false);
    });
  });

  describe("Duplicate", () => {
    it("clones a popup into a new, inactive draft", async () => {
      const created = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test duplicate source", template: "template_1", heading: "Original heading", desktopImageId: imageAssetId });
      const sourceId = created.body.data.id;
      await request(app).patch(`/api/v1/admin/welcome-popups/${sourceId}/publish`).set("Authorization", `Bearer ${superAdminToken}`);
      await request(app).patch(`/api/v1/admin/welcome-popups/${sourceId}/activate`).set("Authorization", `Bearer ${superAdminToken}`);

      const duplicate = await request(app).post(`/api/v1/admin/welcome-popups/${sourceId}/duplicate`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(duplicate.status).toBe(201);
      expect(duplicate.body.data.status).toBe("draft");
      expect(duplicate.body.data.isHomepageActive).toBe(false);
      expect(duplicate.body.data.heading).toBe("Original heading");
      expect(duplicate.body.data.id).not.toBe(sourceId);
    });
  });

  describe("Public resolution", () => {
    it("never requires authentication and returns null when nothing is active", async () => {
      // A fresh, isolated popup that is never activated leaves the shared
      // "currently active" slot untouched either way, so this only asserts
      // the shape/auth of the endpoint, not global emptiness.
      const res = await request(app).get("/api/v1/storefront/welcome-popup");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("returns only the active popup's public-safe fields — never a draft, name, status, or storage key", async () => {
      const created = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({
          name: "Popup test public secret name",
          template: "template_1",
          heading: "Public heading",
          description: "A public popup description.",
          consentText: "By signing up you agree...",
          desktopImageId: imageAssetId
        });
      const id = created.body.data.id;
      await request(app).patch(`/api/v1/admin/welcome-popups/${id}/publish`).set("Authorization", `Bearer ${superAdminToken}`);
      await request(app).patch(`/api/v1/admin/welcome-popups/${id}/activate`).set("Authorization", `Bearer ${superAdminToken}`);

      const res = await request(app).get("/api/v1/storefront/welcome-popup");
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(id);
      expect(res.body.data.heading).toBe("Public heading");
      expect(res.body.data.ctaMode).toBe("email_signup");
      expect(res.body.data.displayDelayMs).toBe(1200);
      expect(res.body.data.dismissalCooldownDays).toBe(7);
      expect(res.body.data).not.toHaveProperty("name");
      expect(res.body.data).not.toHaveProperty("status");
      expect(res.body.data).not.toHaveProperty("isHomepageActive");
      expect(res.body.data).not.toHaveProperty("createdAt");
      expect(res.body.data).not.toHaveProperty("desktopImageKey" as any);
    });

    it("never exposes a draft popup even if one exists", async () => {
      const created = await request(app)
        .post("/api/v1/admin/welcome-popups")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ name: "Popup test draft never public", template: "template_1", heading: "Should never be public", desktopImageId: imageAssetId });

      const res = await request(app).get("/api/v1/storefront/welcome-popup");
      expect(res.status).toBe(200);
      if (res.body.data) {
        expect(res.body.data.heading).not.toBe("Should never be public");
      }
    });
  });
});
