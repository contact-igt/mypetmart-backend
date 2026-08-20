/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { NewsletterSubscriber } from "../../src/database/tables/NewsletterSubscriberTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { emailService } from "../../src/services/email/email.service.js";

const BASE_URL = "/api/v1/storefront/newsletter";
const ADMIN_URL = "/api/v1/admin/newsletter";

function extractToken(url: string): string {
  const parsed = new URL(url);
  const token = parsed.searchParams.get("token");
  if (!token) {
    throw new Error(`No token found in URL: ${url}`);
  }
  return token;
}

async function subscribeAndCaptureToken(email: string, source?: string): Promise<string> {
  const spy = vi.spyOn(emailService, "sendNewsletterVerification");
  const res = await request(app)
    .post(`${BASE_URL}/subscribe`)
    .send(source ? { email, source } : { email });
  expect(res.status).toBe(200);
  const call = spy.mock.calls.at(-1);
  if (!call) {
    throw new Error("sendNewsletterVerification was not called");
  }
  spy.mockRestore();
  return extractToken(call[1] as string);
}

async function mintAdminToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const admin = await User.create({
    id,
    name: `Newsletter Test Admin ${id}`,
    email,
    password_hash: pwdHash,
    role: "admin",
    status: "active",
    reference_code: `ADM-NL-${id}`
  });
  const { session } = await SessionService.createSession(admin.id, "admin", null, null);
  return TokenService.generateAccessToken({
    sub: String(admin.id),
    sessionId: String(session.id),
    role: "admin",
    sessionType: "admin"
  });
}

describe("Newsletter Backend Integration Tests", () => {
  let adminToken: string;
  const adminId = 99501;

  beforeAll(async () => {
    await connectDatabase();
    await AuthSession.destroy({ where: { user_id: adminId }, force: true });
    await User.destroy({ where: { id: adminId }, force: true });
    adminToken = await mintAdminToken(adminId, "newsletter-test-admin@example.com");
  });

  afterAll(async () => {
    await NewsletterSubscriber.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: adminId }, force: true });
    await User.destroy({ where: { id: adminId }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await NewsletterSubscriber.destroy({ where: {}, truncate: false, force: true });
  });

  describe("POST /subscribe", () => {
    it("rejects an invalid email", async () => {
      const res = await request(app).post(`${BASE_URL}/subscribe`).send({ email: "not-an-email" });
      expect(res.status).toBe(400);
    });

    it("creates a pending subscriber and sends a verification email", async () => {
      const token = await subscribeAndCaptureToken("subscriber-1@example.com", "footer");
      expect(token).toBeTruthy();

      const row = await NewsletterSubscriber.findOne({ where: { normalized_email: "subscriber-1@example.com" } });
      expect(row).not.toBeNull();
      expect(row!.status).toBe("pending");
      expect(row!.source).toBe("footer");
    });

    it("does not re-send or error when already subscribed", async () => {
      const token = await subscribeAndCaptureToken("subscriber-2@example.com");
      await request(app).post(`${BASE_URL}/verify`).send({ token });

      const spy = vi.spyOn(emailService, "sendNewsletterVerification");
      const res = await request(app).post(`${BASE_URL}/subscribe`).send({ email: "subscriber-2@example.com" });
      expect(res.status).toBe(200);
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  describe("POST /verify", () => {
    it("confirms a pending subscriber and returns an unsubscribe token", async () => {
      const token = await subscribeAndCaptureToken("subscriber-3@example.com");
      const res = await request(app).post(`${BASE_URL}/verify`).send({ token });

      expect(res.status).toBe(200);
      expect(res.body.data.email).toBe("subscriber-3@example.com");
      expect(typeof res.body.data.unsubscribeToken).toBe("string");

      const row = await NewsletterSubscriber.findOne({ where: { normalized_email: "subscriber-3@example.com" } });
      expect(row!.status).toBe("subscribed");
      expect(row!.verified_at).not.toBeNull();
    });

    it("rejects an unknown token", async () => {
      const res = await request(app).post(`${BASE_URL}/verify`).send({ token: "not-a-real-token" });
      expect(res.status).toBe(404);
    });

    it("rejects a token that was already consumed", async () => {
      const token = await subscribeAndCaptureToken("subscriber-4@example.com");
      const first = await request(app).post(`${BASE_URL}/verify`).send({ token });
      expect(first.status).toBe(200);

      const second = await request(app).post(`${BASE_URL}/verify`).send({ token });
      expect(second.status).toBe(404);
    });
  });

  describe("POST /unsubscribe", () => {
    it("unsubscribes with a valid unsubscribe token", async () => {
      const verifyToken = await subscribeAndCaptureToken("subscriber-5@example.com");
      const verifyRes = await request(app).post(`${BASE_URL}/verify`).send({ token: verifyToken });
      const unsubscribeToken = verifyRes.body.data.unsubscribeToken as string;

      const res = await request(app).post(`${BASE_URL}/unsubscribe`).send({ token: unsubscribeToken });
      expect(res.status).toBe(200);

      const row = await NewsletterSubscriber.findOne({ where: { normalized_email: "subscriber-5@example.com" } });
      expect(row!.status).toBe("unsubscribed");
      expect(row!.unsubscribed_at).not.toBeNull();
    });

    it("rejects an invalid unsubscribe token", async () => {
      const res = await request(app).post(`${BASE_URL}/unsubscribe`).send({ token: "not-a-real-token" });
      expect(res.status).toBe(404);
    });

    it("allows resubscribing after unsubscribing", async () => {
      const verifyToken = await subscribeAndCaptureToken("subscriber-6@example.com");
      const verifyRes = await request(app).post(`${BASE_URL}/verify`).send({ token: verifyToken });
      await request(app).post(`${BASE_URL}/unsubscribe`).send({ token: verifyRes.body.data.unsubscribeToken });

      const resubscribeToken = await subscribeAndCaptureToken("subscriber-6@example.com");
      const res = await request(app).post(`${BASE_URL}/verify`).send({ token: resubscribeToken });
      expect(res.status).toBe(200);

      const row = await NewsletterSubscriber.findOne({ where: { normalized_email: "subscriber-6@example.com" } });
      expect(row!.status).toBe("subscribed");
    });
  });

  describe("GET /admin/newsletter/subscribers", () => {
    it("rejects an unauthenticated request", async () => {
      const res = await request(app).get(`${ADMIN_URL}/subscribers`);
      expect(res.status).toBe(401);
    });

    it("lists subscribers for an authenticated admin", async () => {
      const token = await subscribeAndCaptureToken("subscriber-7@example.com");
      await request(app).post(`${BASE_URL}/verify`).send({ token });

      const res = await request(app).get(`${ADMIN_URL}/subscribers`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.some((item: { email: string }) => item.email === "subscriber-7@example.com")).toBe(true);
    });

    it("filters by status", async () => {
      const res = await request(app)
        .get(`${ADMIN_URL}/subscribers`)
        .query({ status: "unsubscribed" })
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      for (const item of res.body.data.items as Array<{ status: string }>) {
        expect(item.status).toBe("unsubscribed");
      }
    });
  });
});
