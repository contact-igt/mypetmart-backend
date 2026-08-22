/* eslint-disable */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { User, AuthSession, ContactEnquiry } from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Contact Enquiry Backend Integration Tests", () => {
  let adminToken: string = "";
  let customerToken: string = "";

  beforeAll(async () => {
    await connectDatabase();

    const testEmails = ["contact-test-admin@example.com", "contact-test-customer@example.com"];
    const existingUsers = await User.findAll({ where: { email: testEmails }, paranoid: false });
    if (existingUsers.length > 0) {
      const ids = existingUsers.map((u) => u.id);
      await AuthSession.destroy({ where: { user_id: ids }, force: true });
      await User.destroy({ where: { id: ids }, force: true });
    }

    const pwdHash = await PasswordService.hash("TestPass123!@#");

    const adminUser = await User.create({
      id: 99301,
      name: "Contact Admin",
      email: "contact-test-admin@example.com",
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099301"
    });
    const { session: adminSession } = await SessionService.createSession(adminUser.id, "admin", null, null);
    adminToken = TokenService.generateAccessToken({
      sub: String(adminUser.id),
      sessionId: String(adminSession.id),
      role: "admin",
      sessionType: "admin"
    });

    const customerUser = await User.create({
      id: 99302,
      name: "Contact Customer",
      email: "contact-test-customer@example.com",
      password_hash: pwdHash,
      role: "customer",
      status: "active",
      reference_code: "CUS-099302"
    });
    const { session: customerSession } = await SessionService.createSession(customerUser.id, "customer", null, null);
    customerToken = TokenService.generateAccessToken({
      sub: String(customerUser.id),
      sessionId: String(customerSession.id),
      role: "customer",
      sessionType: "customer"
    });

    await ContactEnquiry.destroy({ where: {}, force: true });
  });

  afterAll(async () => {
    await ContactEnquiry.destroy({ where: {}, force: true });

    const testEmails = ["contact-test-admin@example.com", "contact-test-customer@example.com"];
    const existingUsers = await User.findAll({ where: { email: testEmails }, paranoid: false });
    if (existingUsers.length > 0) {
      const ids = existingUsers.map((u) => u.id);
      await AuthSession.destroy({ where: { user_id: ids }, force: true });
      await User.destroy({ where: { id: ids }, force: true });
    }

    await disconnectDatabase();
  });

  describe("Storefront submission (POST /storefront/contact-enquiries)", () => {
    it("allows a guest to submit a valid enquiry", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "Guest Visitor",
        email: "guest@example.com",
        subject: "Product Question",
        message: "Does this shampoo work for cats too?"
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.success).toBe(true);
      expect(res.body.data.enquiryNumber).toMatch(/^ENQ-\d{6}$/);
    });

    it("allows an authenticated customer to submit without special handling", async () => {
      const res = await request(app)
        .post("/api/v1/storefront/contact-enquiries")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({
          name: "Contact Customer",
          email: "contact-test-customer@example.com",
          subject: "Something Else",
          message: "Just saying hi."
        });

      expect(res.status).toBe(201);
      expect(res.body.data.enquiryNumber).toMatch(/^ENQ-\d{6}$/);
    });

    it("generates a unique, sequential enquiryNumber and defaults status to new", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "Sequence Check",
        email: "sequence@example.com",
        subject: "Product Question",
        message: "Checking the enquiry number generation."
      });

      expect(res.status).toBe(201);
      const row = await ContactEnquiry.findOne({ where: { enquiry_number: res.body.data.enquiryNumber } });
      expect(row).not.toBeNull();
      expect(row?.status).toBe("new");
    });

    it.each(["Product Question", "Order Question", "Something Else"])("accepts the valid subject value '%s'", async (subject) => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "Subject Check",
        email: "subject-check@example.com",
        subject,
        message: "Checking subject acceptance."
      });
      expect(res.status).toBe(201);
    });

    it("rejects an invalid subject value", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "Bad Subject",
        email: "bad-subject@example.com",
        subject: "Not A Real Subject",
        message: "This should fail."
      });
      expect(res.status).toBe(400);
      expect(res.body.error.errors.subject).toBeDefined();
    });

    it("accepts an enquiry with optional phone and optional orderNumber supplied", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "Order Asker",
        email: "order-asker@example.com",
        phone: "+91 98765 43210",
        subject: "Order Question",
        orderNumber: "ORD-000123",
        message: "Where is my order?"
      });

      expect(res.status).toBe(201);
      const row = await ContactEnquiry.findOne({ where: { enquiry_number: res.body.data.enquiryNumber } });
      expect(row?.phone).toBe("+91 98765 43210");
      expect(row?.order_number).toBe("ORD-000123");
    });

    it("accepts an Order Question enquiry with orderNumber omitted (not required)", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "No Order Number",
        email: "no-order-number@example.com",
        subject: "Order Question",
        message: "I have an order question but don't have my order number handy."
      });

      expect(res.status).toBe(201);
      const row = await ContactEnquiry.findOne({ where: { enquiry_number: res.body.data.enquiryNumber } });
      expect(row?.order_number).toBeNull();
    });

    it("requires name", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        email: "no-name@example.com",
        subject: "Product Question",
        message: "Missing name."
      });
      expect(res.status).toBe(400);
      expect(res.body.error.errors.name).toBeDefined();
    });

    it("requires a valid email", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "Bad Email",
        email: "not-an-email",
        subject: "Product Question",
        message: "Invalid email format."
      });
      expect(res.status).toBe(400);
      expect(res.body.error.errors.email).toBeDefined();
    });

    it("requires message", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "No Message",
        email: "no-message@example.com",
        subject: "Product Question"
      });
      expect(res.status).toBe(400);
      expect(res.body.error.errors.message).toBeDefined();
    });

    it("ignores Admin-only fields supplied by the customer (status, adminNote, enquiryNumber, id cannot be set)", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        id: 999999,
        enquiryNumber: "ENQ-999999",
        name: "Sneaky Customer",
        email: "sneaky@example.com",
        subject: "Product Question",
        message: "Trying to set admin fields.",
        status: "resolved",
        adminNote: "Should never be settable by a customer."
      });

      expect(res.status).toBe(201);
      expect(res.body.data.enquiryNumber).not.toBe("ENQ-999999");

      const row = await ContactEnquiry.findOne({ where: { enquiry_number: res.body.data.enquiryNumber } });
      expect(row?.status).toBe("new");
      expect(row?.admin_note).toBeNull();
    });

    it("never returns adminNote in the public submission response", async () => {
      const res = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "Response Shape Check",
        email: "response-shape@example.com",
        subject: "Product Question",
        message: "Checking response shape."
      });
      expect(res.status).toBe(201);
      expect(res.body.data).not.toHaveProperty("adminNote");
      expect(res.body.data).not.toHaveProperty("id");
      expect(Object.keys(res.body.data).sort()).toEqual(["enquiryNumber", "success"].sort());
    });
  });

  describe("Admin authorization", () => {
    it("rejects unauthenticated list request with 401", async () => {
      const res = await request(app).get("/api/v1/admin/contact-enquiries");
      expect(res.status).toBe(401);
    });

    it("rejects customer token with 401", async () => {
      const res = await request(app)
        .get("/api/v1/admin/contact-enquiries")
        .set("Authorization", `Bearer ${customerToken}`);
      expect(res.status).toBe(401);
    });
  });

  describe("Admin list / search / filter / pagination", () => {
    it("lists submitted enquiries newest-first", async () => {
      const res = await request(app)
        .get("/api/v1/admin/contact-enquiries")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data.items)).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThan(0);
      const dates = res.body.data.items.map((item: { createdAt: string }) => new Date(item.createdAt).getTime());
      expect([...dates]).toEqual([...dates].sort((a, b) => b - a));
    });

    it("searches by name, email, and orderNumber", async () => {
      const byName = await request(app)
        .get("/api/v1/admin/contact-enquiries?search=Order Asker")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(byName.body.data.items.some((i: { name: string }) => i.name === "Order Asker")).toBe(true);

      const byEmail = await request(app)
        .get("/api/v1/admin/contact-enquiries?search=order-asker@example.com")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(byEmail.body.data.items.some((i: { email: string }) => i.email === "order-asker@example.com")).toBe(true);

      const byOrderNumber = await request(app)
        .get("/api/v1/admin/contact-enquiries?search=ORD-000123")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(byOrderNumber.body.data.items.some((i: { orderNumber: string | null }) => i.orderNumber === "ORD-000123")).toBe(true);
    });

    it("filters by status", async () => {
      const res = await request(app)
        .get("/api/v1/admin/contact-enquiries?status=new")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items.every((i: { status: string }) => i.status === "new")).toBe(true);
    });

    it("paginates results", async () => {
      const res = await request(app)
        .get("/api/v1/admin/contact-enquiries?page=1&pageSize=2")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeLessThanOrEqual(2);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(2);
      expect(res.body.data.total).toBeGreaterThan(0);
    });
  });

  describe("Admin detail / status / internal note management", () => {
    let enquiryId: number;
    let enquiryOriginalMessage: string;

    beforeAll(async () => {
      const createRes = await request(app).post("/api/v1/storefront/contact-enquiries").send({
        name: "Management Target",
        email: "management-target@example.com",
        subject: "Order Question",
        orderNumber: "ORD-555555",
        message: "This is the original submitted message."
      });
      const row = await ContactEnquiry.findOne({ where: { enquiry_number: createRes.body.data.enquiryNumber } });
      enquiryId = row!.id;
      enquiryOriginalMessage = row!.message;
    });

    it("returns full enquiry detail for Admin", async () => {
      const res = await request(app)
        .get(`/api/v1/admin/contact-enquiries/${enquiryId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        id: enquiryId,
        name: "Management Target",
        email: "management-target@example.com",
        subject: "Order Question",
        orderNumber: "ORD-555555",
        message: enquiryOriginalMessage,
        status: "new"
      });
    });

    it("returns 404 for an unknown enquiry id", async () => {
      const res = await request(app)
        .get("/api/v1/admin/contact-enquiries/2147483647")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CONTACT_ENQUIRY_NOT_FOUND");
    });

    it("updates status through the workflow and updates the internal admin note", async () => {
      const toInProgress = await request(app)
        .patch(`/api/v1/admin/contact-enquiries/${enquiryId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "in_progress" });
      expect(toInProgress.status).toBe(200);
      expect(toInProgress.body.data.status).toBe("in_progress");

      const withNote = await request(app)
        .patch(`/api/v1/admin/contact-enquiries/${enquiryId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ adminNote: "Called the customer, awaiting their reply." });
      expect(withNote.status).toBe(200);
      expect(withNote.body.data.adminNote).toBe("Called the customer, awaiting their reply.");
      expect(withNote.body.data.status).toBe("in_progress"); // untouched by the note-only update

      const toResolved = await request(app)
        .patch(`/api/v1/admin/contact-enquiries/${enquiryId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "resolved" });
      expect(toResolved.status).toBe(200);
      expect(toResolved.body.data.status).toBe("resolved");

      const toClosed = await request(app)
        .patch(`/api/v1/admin/contact-enquiries/${enquiryId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "closed" });
      expect(toClosed.status).toBe(200);
      expect(toClosed.body.data.status).toBe("closed");
    });

    it("never lets a management update overwrite the original customer submission fields", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/contact-enquiries/${enquiryId}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          status: "resolved",
          adminNote: "Final note.",
          name: "Tampered Name",
          email: "tampered@example.com",
          message: "Tampered message.",
          subject: "Something Else"
        } as unknown as Record<string, unknown>);

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Management Target");
      expect(res.body.data.email).toBe("management-target@example.com");
      expect(res.body.data.message).toBe(enquiryOriginalMessage);
      expect(res.body.data.subject).toBe("Order Question");
    });
  });
});
