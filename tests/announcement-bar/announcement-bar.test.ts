/* eslint-disable */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { Op } from "sequelize";
import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { AnnouncementBarItem, AuthSession, User } from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Announcement Bar Backend Integration Tests", () => {
  let superAdminToken: string = "";
  let adminToken: string = "";
  let customerToken: string = "";

  beforeAll(async () => {
    await connectDatabase();

    const testEmails = ["annbar-test-super@example.com", "annbar-test-admin@example.com", "annbar-test-user@example.com"];
    const existingUsers = await User.findAll({ where: { email: testEmails }, paranoid: false });
    if (existingUsers.length > 0) {
      const ids = existingUsers.map((u) => u.id);
      await AuthSession.destroy({ where: { user_id: ids }, force: true });
      await User.destroy({ where: { id: ids }, force: true });
    }

    const pwdHash = await PasswordService.hash("TestPass123!@#");

    const superAdmin = await User.create({
      id: 99101,
      name: "AnnBar Super Admin",
      email: "annbar-test-super@example.com",
      password_hash: pwdHash,
      role: "super_admin",
      status: "active",
      reference_code: "SUP-099101"
    });
    const { session: superSession } = await SessionService.createSession(superAdmin.id, "admin", null, null);
    superAdminToken = TokenService.generateAccessToken({
      sub: String(superAdmin.id),
      sessionId: String(superSession.id),
      role: "super_admin",
      sessionType: "admin"
    });

    const adminUser = await User.create({
      id: 99102,
      name: "AnnBar Admin",
      email: "annbar-test-admin@example.com",
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099102"
    });
    const { session: adminSession } = await SessionService.createSession(adminUser.id, "admin", null, null);
    adminToken = TokenService.generateAccessToken({
      sub: String(adminUser.id),
      sessionId: String(adminSession.id),
      role: "admin",
      sessionType: "admin"
    });

    const customerUser = await User.create({
      id: 99103,
      name: "AnnBar Customer",
      email: "annbar-test-user@example.com",
      password_hash: pwdHash,
      role: "customer",
      status: "active",
      reference_code: "CUS-099103"
    });
    const { session: custSession } = await SessionService.createSession(customerUser.id, "customer", null, null);
    customerToken = TokenService.generateAccessToken({
      sub: String(customerUser.id),
      sessionId: String(custSession.id),
      role: "customer",
      sessionType: "customer"
    });

    await AnnouncementBarItem.destroy({ where: { message: { [Op.like]: "AnnBar test%" } }, force: true });
  });

  afterAll(async () => {
    await AnnouncementBarItem.destroy({ where: { message: { [Op.like]: "AnnBar test%" } }, force: true });
    await AuthSession.destroy({ where: { user_id: [99101, 99102, 99103] }, force: true });
    await User.destroy({ where: { id: [99101, 99102, 99103] }, force: true });
    await disconnectDatabase();
  });

  describe("Admin authorization", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get("/api/v1/admin/announcement-bar");
      expect(res.status).toBe(401);
    });

    it("rejects a plain admin (super_admin required)", async () => {
      const res = await request(app).get("/api/v1/admin/announcement-bar").set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(403);
    });

    it("rejects a customer session", async () => {
      const res = await request(app).get("/api/v1/admin/announcement-bar").set("Authorization", `Bearer ${customerToken}`);
      expect(res.status).toBe(401);
    });
  });

  describe("Admin CRUD & reorder", () => {
    let createdId: number;

    it("rejects an end time that is not after the start time", async () => {
      const startsAt = new Date("2030-01-01T10:00:00.000Z").toISOString();
      const res = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test invalid schedule", startsAt, endsAt: startsAt });

      expect(res.status).toBe(400);
      expect(res.body.error.errors.endsAt).toContain("End date must be after the start date.");
    });

    it("creates an item", async () => {
      const res = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test free shipping over ₹999", linkUrl: "/shop", linkLabel: "Shop Now" });

      expect(res.status).toBe(201);
      expect(res.body.data.message).toBe("AnnBar test free shipping over ₹999");
      expect(res.body.data.linkUrl).toBe("/shop");
      expect(res.body.data.linkLabel).toBe("Shop Now");
      expect(res.body.data.active).toBe(true);
      createdId = res.body.data.id;
    });

    it("rejects a button label longer than 60 characters", async () => {
      const res = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test long label", linkUrl: "/shop", linkLabel: "x".repeat(61) });
      expect(res.status).toBe(400);
    });

    it("clears linkLabel back to null on update", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/announcement-bar/${createdId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ linkLabel: null });
      expect(res.status).toBe(200);
      expect(res.body.data.linkLabel).toBeNull();
      expect(res.body.data.linkUrl).toBe("/shop");
    });

    it("rejects an empty message", async () => {
      const res = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "" });
      expect(res.status).toBe(400);
    });

    it("rejects a link URL that is not absolute or site-relative", async () => {
      const res = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test bad link", linkUrl: "javascript:alert(1)" });
      expect(res.status).toBe(400);
    });

    it("lists items including the created one", async () => {
      const res = await request(app).get("/api/v1/admin/announcement-bar").set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.some((i: { id: number }) => i.id === createdId)).toBe(true);
    });

    it("updates an item", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/announcement-bar/${createdId}`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test updated message", active: false });
      expect(res.status).toBe(200);
      expect(res.body.data.message).toBe("AnnBar test updated message");
      expect(res.body.data.active).toBe(false);
    });

    it("404s for an unknown item id", async () => {
      const res = await request(app)
        .patch("/api/v1/admin/announcement-bar/9999999")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test x" });
      expect(res.status).toBe(404);
    });

    it("reorders items and rejects duplicate display orders", async () => {
      const second = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test second message" });
      const secondId = second.body.data.id;

      const dup = await request(app)
        .patch("/api/v1/admin/announcement-bar/reorder")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ items: [{ itemId: createdId, displayOrder: 5 }, { itemId: secondId, displayOrder: 5 }] });
      expect(dup.status).toBe(400);

      const ok = await request(app)
        .patch("/api/v1/admin/announcement-bar/reorder")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ items: [{ itemId: createdId, displayOrder: 10 }, { itemId: secondId, displayOrder: 5 }] });
      expect(ok.status).toBe(200);
      expect(ok.body.data[0].id).toBe(secondId);
    });

    it("deletes an item", async () => {
      const res = await request(app).delete(`/api/v1/admin/announcement-bar/${createdId}`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);

      const check = await request(app).get(`/api/v1/admin/announcement-bar/${createdId}`).set("Authorization", `Bearer ${superAdminToken}`);
      expect(check.status).toBe(404);
    });
  });

  describe("Storefront public feed", () => {
    it("never requires authentication", async () => {
      const res = await request(app).get("/api/v1/storefront/announcement-bar");
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("only returns active items within their schedule window", async () => {
      const now = Date.now();

      const active = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test always active" });

      const inactive = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test inactive", active: false });

      const future = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test starts in future", startsAt: new Date(now + 86_400_000).toISOString() });

      const expired = await request(app)
        .post("/api/v1/admin/announcement-bar")
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ message: "AnnBar test already ended", endsAt: new Date(now - 86_400_000).toISOString() });

      const feed = await request(app).get("/api/v1/storefront/announcement-bar");
      const messages = feed.body.data.map((i: { message: string }) => i.message);

      expect(messages).toContain("AnnBar test always active");
      expect(messages).not.toContain("AnnBar test inactive");
      expect(messages).not.toContain("AnnBar test starts in future");
      expect(messages).not.toContain("AnnBar test already ended");

      for (const res of [active, inactive, future, expired]) {
        await request(app).delete(`/api/v1/admin/announcement-bar/${res.body.data.id}`).set("Authorization", `Bearer ${superAdminToken}`);
      }
    });
  });
});
