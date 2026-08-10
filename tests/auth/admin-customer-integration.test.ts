/* eslint-disable */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { User, AuthSession } from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Stage 9: Admin Customer APIs", () => {
  let superAdminToken: string = "";
  let adminToken: string = "";
  let customerToken: string = "";
  let testCustomerId: number = 0;
  let testAdminId: number = 0;

  beforeAll(async () => {
    await connectDatabase();

    const testEmails = [
      "admin-cust-super@example.com",
      "admin-cust-admin@example.com",
      "admin-cust-user1@example.com",
      "admin-cust-user2@example.com"
    ];
    const existingUsers = await User.findAll({ where: { email: testEmails } });
    if (existingUsers.length > 0) {
      const ids = existingUsers.map((u) => u.id);
      await AuthSession.destroy({ where: { user_id: ids }, force: true });
      await User.destroy({ where: { id: ids }, force: true });
    }

    const pwdHash = await PasswordService.hash("TestPass123!@#");

    // 1. Create Super Admin
    const superAdmin = await User.create({
      id: 10001,
      name: "Super Admin Test",
      email: "admin-cust-super@example.com",
      password_hash: pwdHash,
      role: "super_admin",
      status: "active",
      reference_code: "SUP-010001"
    });
    const { session: superSession } = await SessionService.createSession(superAdmin.id, "admin", null, null);
    superAdminToken = TokenService.generateAccessToken({
      sub: String(superAdmin.id),
      sessionId: String(superSession.id),
      role: "super_admin",
      sessionType: "admin"
    });

    // 2. Create Normal Admin
    const adminUser = await User.create({
      id: 10002,
      name: "Normal Admin Test",
      email: "admin-cust-admin@example.com",
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-010002"
    });
    testAdminId = adminUser.id;
    const { session: adminSession } = await SessionService.createSession(adminUser.id, "admin", null, null);
    adminToken = TokenService.generateAccessToken({
      sub: String(adminUser.id),
      sessionId: String(adminSession.id),
      role: "admin",
      sessionType: "admin"
    });

    // 3. Create Test Customer 1
    const customer1 = await User.create({
      id: 10003,
      name: "Alice Customer",
      email: "admin-cust-user1@example.com",
      password_hash: pwdHash,
      role: "customer",
      status: "active",
      reference_code: "CUS-010003"
    });
    testCustomerId = customer1.id;
    const { session: custSession } = await SessionService.createSession(customer1.id, "customer", null, null);
    customerToken = TokenService.generateAccessToken({
      sub: String(customer1.id),
      sessionId: String(custSession.id),
      role: "customer",
      sessionType: "customer"
    });

    // 4. Create Test Customer 2
    await User.create({
      id: 10004,
      name: "Bob Customer",
      email: "admin-cust-user2@example.com",
      password_hash: pwdHash,
      role: "customer",
      status: "disabled",
      reference_code: "CUS-010004"
    });
  });

  afterAll(async () => {
    const testEmails = [
      "admin-cust-super@example.com",
      "admin-cust-admin@example.com",
      "admin-cust-user1@example.com",
      "admin-cust-user2@example.com"
    ];
    const existingUsers = await User.findAll({ where: { email: testEmails } });
    if (existingUsers.length > 0) {
      const ids = existingUsers.map((u) => u.id);
      await AuthSession.destroy({ where: { user_id: ids }, force: true });
      await User.destroy({ where: { id: ids }, force: true });
    }
    await disconnectDatabase();
  });

  it("1. Admin can list customers", async () => {
    const res = await request(app)
      .get("/api/v1/admin/customers")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
    expect(res.body.data.pagination).toBeDefined();
  });

  it("2. Super admin can list customers", async () => {
    const res = await request(app)
      .get("/api/v1/admin/customers")
      .set("Authorization", `Bearer ${superAdminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.items.length).toBeGreaterThanOrEqual(2);
  });

  it("3. Customer role cannot list customers", async () => {
    const res = await request(app)
      .get("/api/v1/admin/customers")
      .set("Authorization", `Bearer ${customerToken}`);

    expect(res.status).toBe(401);
  });

  it("4. Unauthenticated request is rejected", async () => {
    const res = await request(app).get("/api/v1/admin/customers");
    expect(res.status).toBe(401);
  });

  it("5. Customer list excludes admin and super_admin accounts", async () => {
    const res = await request(app)
      .get("/api/v1/admin/customers?limit=100")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    const emails = res.body.data.items.map((u: { email: string }) => u.email);
    expect(emails).not.toContain("admin-cust-super@example.com");
    expect(emails).not.toContain("admin-cust-admin@example.com");
    expect(emails).toContain("admin-cust-user1@example.com");
  });

  it("6. Pagination works", async () => {
    const res = await request(app)
      .get("/api/v1/admin/customers?page=1&limit=1")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.pagination.limit).toBe(1);
    expect(res.body.data.pagination.page).toBe(1);
    expect(res.body.data.pagination.totalPages).toBeGreaterThanOrEqual(2);
  });

  it("7. Search by name/email/reference works", async () => {
    const res = await request(app)
      .get("/api/v1/admin/customers?search=Alice")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBe(1);
    expect(res.body.data.items[0].name).toBe("Alice Customer");
  });

  it("8. Valid customer detail works", async () => {
    const res = await request(app)
      .get(`/api/v1/admin/customers/${testCustomerId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(testCustomerId);
    expect(res.body.data.email).toBe("admin-cust-user1@example.com");
    expect(res.body.data.referenceCode).toMatch(/^CUS-\d{6}$/);
    expect(res.body.data.password_hash).toBeUndefined();
  });

  it("9. Admin/super-admin ID passed to customer-detail endpoint returns safe not-found", async () => {
    const res = await request(app)
      .get(`/api/v1/admin/customers/${testAdminId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
  });

  it("10. Invalid numeric customer ID is rejected", async () => {
    const res = await request(app)
      .get("/api/v1/admin/customers/invalid-id")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(400);
  });
});
