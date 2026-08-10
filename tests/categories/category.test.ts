/* eslint-disable */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { User, AuthSession, Category, Product } from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { DATABASE_TABLE_NAMES } from "../../src/constants/database.constants.js";

describe("Stage 12: Categories Backend Integration Tests", () => {
  let superAdminToken: string = "";
  let adminToken: string = "";
  let customerToken: string = "";
  let testAdminUser: User;

  beforeAll(async () => {
    await connectDatabase();

    // Clean up test users
    const testEmails = ["cat-test-super@example.com", "cat-test-admin@example.com", "cat-test-user@example.com"];
    const existingUsers = await User.findAll({ where: { email: testEmails }, paranoid: false });
    if (existingUsers.length > 0) {
      const ids = existingUsers.map((u) => u.id);
      await AuthSession.destroy({ where: { user_id: ids }, force: true });
      await User.destroy({ where: { id: ids }, force: true });
    }

    const pwdHash = await PasswordService.hash("TestPass123!@#");

    // Super Admin
    const superAdmin = await User.create({
      id: 99001,
      name: "Cat Super Admin",
      email: "cat-test-super@example.com",
      password_hash: pwdHash,
      role: "super_admin",
      status: "active",
      reference_code: "SUP-099001"
    });
    const { session: superSession } = await SessionService.createSession(superAdmin.id, "admin", null, null);
    superAdminToken = TokenService.generateAccessToken({
      sub: String(superAdmin.id),
      sessionId: String(superSession.id),
      role: "super_admin",
      sessionType: "admin"
    });

    // Admin
    const adminUser = await User.create({
      id: 99002,
      name: "Cat Admin",
      email: "cat-test-admin@example.com",
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099002"
    });
    testAdminUser = adminUser;
    const { session: adminSession } = await SessionService.createSession(adminUser.id, "admin", null, null);
    adminToken = TokenService.generateAccessToken({
      sub: String(adminUser.id),
      sessionId: String(adminSession.id),
      role: "admin",
      sessionType: "admin"
    });

    // Customer
    const customerUser = await User.create({
      id: 99003,
      name: "Cat Customer",
      email: "cat-test-user@example.com",
      password_hash: pwdHash,
      role: "customer",
      status: "active",
      reference_code: "CUS-099003"
    });
    const { session: custSession } = await SessionService.createSession(customerUser.id, "customer", null, null);
    customerToken = TokenService.generateAccessToken({
      sub: String(customerUser.id),
      sessionId: String(custSession.id),
      role: "customer",
      sessionType: "customer"
    });

    // Clean up any test categories matching test slugs
    const testSlugs = [
      "dogs-food",
      "cats-food",
      "birds-accessories",
      "fish-supplies",
      "test-reorder-1",
      "test-reorder-2",
      "test-reorder-3",
      "delete-guard-cat",
      "soft-deleted-slug-test"
    ];
    const existingCats = await Category.findAll({ where: { slug: testSlugs }, paranoid: false });
    if (existingCats.length > 0) {
      const catIds = existingCats.map((c) => c.id);
      await Product.destroy({ where: { category_id: catIds }, force: true });
      await Category.destroy({ where: { id: catIds }, force: true });
    }
  });

  afterAll(async () => {
    const testSlugs = [
      "dogs-food",
      "cats-food",
      "birds-accessories",
      "fish-supplies",
      "test-reorder-1",
      "test-reorder-2",
      "test-reorder-3",
      "delete-guard-cat",
      "soft-deleted-slug-test"
    ];
    const existingCats = await Category.findAll({ where: { slug: testSlugs }, paranoid: false });
    if (existingCats.length > 0) {
      const catIds = existingCats.map((c) => c.id);
      await Product.destroy({ where: { category_id: catIds }, force: true });
      await Category.destroy({ where: { id: catIds }, force: true });
    }

    const testEmails = ["cat-test-super@example.com", "cat-test-admin@example.com", "cat-test-user@example.com"];
    const existingUsers = await User.findAll({ where: { email: testEmails }, paranoid: false });
    if (existingUsers.length > 0) {
      const ids = existingUsers.map((u) => u.id);
      await AuthSession.destroy({ where: { user_id: ids }, force: true });
      await User.destroy({ where: { id: ids }, force: true });
    }

    await disconnectDatabase();
  });

  describe("Storefront Category APIs (Public)", () => {
    it("should return public active categories", async () => {
      const res = await request(app).get("/api/v1/storefront/categories");
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("should return 404 for unknown category slug", async () => {
      const res = await request(app).get("/api/v1/storefront/categories/nonexistent-category-slug-12345");
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("CATEGORY_NOT_FOUND");
    });
  });

  describe("Admin Category Authorization", () => {
    it("should reject unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/v1/admin/categories");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("should reject customer token request with 401", async () => {
      const res = await request(app)
        .get("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${customerToken}`);
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("should allow admin token request", async () => {
      const res = await request(app)
        .get("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it("should allow super admin token request", async () => {
      const res = await request(app)
        .get("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${superAdminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("Admin Category CRUD & Lifecycle", () => {
    let createdCat1Id: number;
    let createdCat2Id: number;

    it("should create a new category using transactional IdSequenceService", async () => {
      const payload = {
        name: "Dogs Food",
        description: "Nutritious food for dogs",
        petType: "dog",
        active: true
      };

      const res = await request(app)
        .post("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toHaveProperty("id");
      expect(typeof res.body.data.id).toBe("number");
      expect(res.body.data.id).toBeGreaterThan(0);
      expect(res.body.data.name).toBe("Dogs Food");
      expect(res.body.data.slug).toBe("dogs-food");
      expect(res.body.data.petType).toBe("dog");
      expect(res.body.data.active).toBe(true);
      expect(res.body.data.productCount).toBe(0);

      createdCat1Id = res.body.data.id;
    });

    it("should reject creation with duplicate slug (409 CategorySlugConflictError)", async () => {
      const payload = {
        name: "Dogs Food",
        slug: "dogs-food"
      };

      const res = await request(app)
        .post("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe("CATEGORY_SLUG_CONFLICT");
    });

    it("should create a second category with sequential ID", async () => {
      const payload = {
        name: "Cats Food",
        description: "Delicious food for cats",
        petType: "cat",
        active: true
      };

      const res = await request(app)
        .post("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(payload);

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeGreaterThan(createdCat1Id);
      createdCat2Id = res.body.data.id;
    });

    it("should retrieve storefront category by slug", async () => {
      const res = await request(app).get("/api/v1/storefront/categories/dogs-food");
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(createdCat1Id);
      expect(res.body.data.name).toBe("Dogs Food");
    });

    it("should retrieve admin category detail by ID", async () => {
      const res = await request(app)
        .get(`/api/v1/admin/categories/${createdCat1Id}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(createdCat1Id);
      expect(res.body.data.name).toBe("Dogs Food");
    });

    it("should reject invalid numeric category ID with 400", async () => {
      const res = await request(app)
        .get("/api/v1/admin/categories/invalid-id-abc")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_CATEGORY_ID");
    });

    it("should update category without altering slug unless explicitly specified", async () => {
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${createdCat1Id}`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Premium Dogs Food",
          description: "Updated description"
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe("Premium Dogs Food");
      expect(res.body.data.slug).toBe("dogs-food"); // Slug unchanged!
      expect(res.body.data.description).toBe("Updated description");
    });

    it("should update category status (deactivate & reactivate)", async () => {
      // 1. Deactivate
      const deactivateRes = await request(app)
        .patch(`/api/v1/admin/categories/${createdCat1Id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ active: false });

      expect(deactivateRes.status).toBe(200);
      expect(deactivateRes.body.data.active).toBe(false);

      // Verify storefront detail returns 404 for inactive category
      const publicRes = await request(app).get("/api/v1/storefront/categories/dogs-food");
      expect(publicRes.status).toBe(404);

      // 2. Reactivate
      const reactivateRes = await request(app)
        .patch(`/api/v1/admin/categories/${createdCat1Id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ active: true });

      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.data.active).toBe(true);

      // Verify storefront detail works again
      const publicRes2 = await request(app).get("/api/v1/storefront/categories/dogs-food");
      expect(publicRes2.status).toBe(200);
    });

    it("should allow deactivating a category that HAS products without throwing CategoryDeleteBlockedError", async () => {
      // Create a test product linked to createdCat1Id
      const pId = await sequelize.transaction(async (t) => {
        return await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.products, t);
      });
      const testProduct = await Product.create({
        id: pId,
        category_id: createdCat1Id,
        name: "Test Dog Food Kibble",
        slug: `test-dog-kibble-${Date.now()}`,
        sku: `SKU-DOG-${Date.now()}`,
        description: "Test kibble",
        price: "29.99",
        stock: 50
      });

      // Status update to active = false should SUCCEED
      const res = await request(app)
        .patch(`/api/v1/admin/categories/${createdCat1Id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ active: false });

      expect(res.status).toBe(200);
      expect(res.body.data.active).toBe(false);

      // Reactivate
      await request(app)
        .patch(`/api/v1/admin/categories/${createdCat1Id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ active: true });

      // Clean up product
      await testProduct.destroy({ force: true });
    });

    it("should block DELETE of a category with associated products (422 CategoryDeleteBlockedError)", async () => {
      // Create a test category and product
      const catRes = await request(app)
        .post("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Delete Guard Cat", slug: "delete-guard-cat" });
      const guardCatId = catRes.body.data.id;

      const pId = await sequelize.transaction(async (t) => {
        return await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.products, t);
      });
      const testProd = await Product.create({
        id: pId,
        category_id: guardCatId,
        name: "Guard Product",
        slug: `guard-prod-${Date.now()}`,
        sku: `SKU-GUARD-${Date.now()}`,
        description: "Guard description",
        price: "19.99",
        stock: 10
      });

      // Attempt DELETE -> Should fail with 422
      const deleteRes = await request(app)
        .delete(`/api/v1/admin/categories/${guardCatId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(deleteRes.status).toBe(422);
      expect(deleteRes.body.error.code).toBe("CATEGORY_DELETE_BLOCKED");

      // Clean up product and then category
      await testProd.destroy({ force: true });
      await request(app)
        .delete(`/api/v1/admin/categories/${guardCatId}`)
        .set("Authorization", `Bearer ${adminToken}`);
    });

    it("should soft delete category without products and preserve committed ID without gaps", async () => {
      const catRes = await request(app)
        .post("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Soft Delete Test", slug: "soft-deleted-slug-test" });
      const softCatId = catRes.body.data.id;

      // Perform soft delete
      const delRes = await request(app)
        .delete(`/api/v1/admin/categories/${softCatId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(delRes.status).toBe(200);
      expect(delRes.body.data.deleted).toBe(true);

      // Verify category is soft-deleted in DB (deleted_at IS NOT NULL)
      const softDeletedRow = await Category.findByPk(softCatId, { paranoid: false });
      expect(softDeletedRow).not.toBeNull();
      expect(softDeletedRow?.deleted_at).not.toBeNull();

      // Verify creating a new category gets a higher sequential ID (no ID recycling)
      const newCatRes = await request(app)
        .post("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Birds Accessories", slug: "birds-accessories" });

      expect(newCatRes.status).toBe(201);
      expect(newCatRes.body.data.id).toBeGreaterThan(softCatId);

      // Verify trying to create a category with the soft-deleted slug STILL returns 409 conflict
      const conflictRes = await request(app)
        .post("/api/v1/admin/categories")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ name: "Soft Delete Conflict", slug: "soft-deleted-slug-test" });

      expect(conflictRes.status).toBe(409);
      expect(conflictRes.body.error.code).toBe("CATEGORY_SLUG_CONFLICT");
    });

    it("should reorder categories transactionally", async () => {
      const productId = await sequelize.transaction((transaction) =>
        IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.products, transaction)
      );
      await Product.create({
        id: productId,
        category_id: createdCat1Id,
        name: "Reorder Count Product",
        slug: "reorder-count-product",
        sku: "REORDER-COUNT-PRODUCT",
        description: "Verifies derived response data",
        price: "10.00",
        stock: 1
      });

      const reorderPayload = {
        items: [
          { categoryId: createdCat2Id, displayOrder: 1 },
          { categoryId: createdCat1Id, displayOrder: 2 }
        ]
      };

      const res = await request(app)
        .patch("/api/v1/admin/categories/reorder")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(reorderPayload);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      const counts = new Map(res.body.data.map((category: { id: number; productCount: number }) => [category.id, category.productCount]));
      expect(counts.get(createdCat1Id)).toBe(1);
      expect(counts.get(createdCat2Id)).toBe(0);
    });

    it("should reject reorder request with duplicate category IDs (400)", async () => {
      const invalidPayload = {
        items: [
          { categoryId: createdCat1Id, displayOrder: 1 },
          { categoryId: createdCat1Id, displayOrder: 2 }
        ]
      };

      const res = await request(app)
        .patch("/api/v1/admin/categories/reorder")
        .set("Authorization", `Bearer ${adminToken}`)
        .send(invalidPayload);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });
  });
});
