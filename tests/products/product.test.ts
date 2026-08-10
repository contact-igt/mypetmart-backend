/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Stage 13 — Products Backend Integration Tests", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "prod-test-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99201,
      name: "Prod Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099201"
    });
    const { session } = await SessionService.createSession(adminUser.id, "admin", null, null);
    adminToken = TokenService.generateAccessToken({
      sub: String(adminUser.id),
      sessionId: String(session.id),
      role: "admin",
      sessionType: "admin"
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    // Clean products, variants, images, categories, and SKU reservations for isolated tests
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    // Create default test category
    const category = await sequelize.transaction(async (t) => {
      const catId = await IdSequenceService.allocateNextId("categories", t);
      return await Category.create(
        {
          id: catId,
          name: "Dog Food",
          slug: "dog-food",
          description: "Premium dog food products",
          pet_type: "dog",
          active: true,
          display_order: 1
        },
        { transaction: t }
      );
    });
    categoryId = category.id;
  });

  it("should create a draft simple product successfully", async () => {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Chicken Adult Kibble",
        sku: "KIBBLE-CHICKEN-001",
        description: "Delicious dry food",
        petType: "dog",
        price: "499.00",
        compareAtPrice: "599.00",
        stock: 50,
        hasVariants: false,
        weightGrams: 1000,
        lengthCm: "20.00",
        widthCm: "15.00",
        heightCm: "30.00"
      });

    if (res.status !== 201) {
      console.error("DEBUG_POST_PRODUCT_FAIL:", res.status, JSON.stringify(res.body, null, 2));
    }
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: "Chicken Adult Kibble",
      sku: "KIBBLE-CHICKEN-001",
      status: "draft",
      price: "499.00",
      compareAtPrice: "599.00",
      stock: 50,
      hasVariants: false
    });
  });

  it("should enforce SKU normalization and cross-table uniqueness", async () => {
    await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Product 1",
        sku: "  prod-unique-001  ",
        description: "Test description",
        price: "100.00"
      });

    // Attempt creating another product with the same SKU (case insensitive)
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Product 2",
        sku: "PROD-UNIQUE-001",
        description: "Test description",
        price: "200.00"
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("PRODUCT_SKU_CONFLICT");
  });

  it("should validate shipping readiness before product activation", async () => {
    // Create product without shipping metrics
    const createRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Unshippable Toy",
        sku: "TOY-001",
        description: "Fun toy",
        price: "299.00"
      });

    const productId = createRes.body.data.id;

    // Attempt status update to active -> expect 422 PRODUCT_NOT_SHIPPING_READY
    const activeRes = await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    expect(activeRes.status).toBe(422);
    expect(activeRes.body.error.code).toBe("PRODUCT_NOT_SHIPPING_READY");
  });

  it("should activate product when shipping metrics are resolved", async () => {
    const createRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Shippable Toy",
        sku: "TOY-002",
        description: "Fun toy",
        price: "299.00",
        weightGrams: 200,
        lengthCm: "10.00",
        widthCm: "10.00",
        heightCm: "5.00"
      });

    const productId = createRes.body.data.id;

    const activeRes = await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    expect(activeRes.status).toBe(200);
    expect(activeRes.body.data.status).toBe("active");
  });

  it("should reject activation of a zero-price simple product", async () => {
    const createRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Zero Price Toy",
        sku: "TOY-ZERO-PRICE",
        description: "Not a free product",
        price: "0.00",
        weightGrams: 200,
        lengthCm: "10.00",
        widthCm: "10.00",
        heightCm: "5.00"
      });

    const activeRes = await request(app)
      .patch(`/api/v1/admin/products/${createRes.body.data.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    expect(activeRes.status).toBe(422);
    expect(activeRes.body.error.code).toBe("PRODUCT_NOT_SELLABLE");
  });

  it("should roll back a zero-price edit on an active simple product", async () => {
    const createRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Active Price Guard Toy",
        sku: "TOY-ACTIVE-PRICE-GUARD",
        description: "Price cannot be cleared while active",
        price: "149.00",
        weightGrams: 200,
        lengthCm: "10.00",
        widthCm: "10.00",
        heightCm: "5.00"
      });
    const productId = createRes.body.data.id;

    await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const updateRes = await request(app)
      .patch(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ price: "0.00" });

    expect(updateRes.status).toBe(422);
    expect(updateRes.body.error.code).toBe("PRODUCT_NOT_SELLABLE");
    expect((await Product.findByPk(productId))?.price).toBe("149.00");
  });

  it("should validate category and product pet type compatibility", async () => {
    // Category is 'dog'
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Catnip Spray",
        sku: "CATNIP-001",
        description: "For cats",
        petType: "cat",
        price: "199.00"
      });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PRODUCT_CATEGORY_INVALID");
  });

  it("should create variant product with nested variants atomically", async () => {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Multi-Pack Kibble",
        sku: "KIBBLE-MULTI-MASTER",
        description: "Various pack sizes",
        hasVariants: true,
        weightGrams: 500,
        lengthCm: "15.00",
        widthCm: "15.00",
        heightCm: "20.00",
        variants: [
          { name: "1kg", sku: "KIBBLE-1KG", price: "299.00", compareAtPrice: "349.00", stock: 20 },
          { name: "5kg", sku: "KIBBLE-5KG", price: "1299.00", compareAtPrice: "1499.00", stock: 10 }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.data.hasVariants).toBe(true);
    expect(res.body.data.price).toBe("299.00"); // Minimum variant price
    expect(res.body.data.compareAtPrice).toBe("349.00");
    expect(res.body.data.stock).toBe(30); // Aggregate stock
    expect(res.body.data.variants).toHaveLength(2);
  });

  it("should duplicate product in draft state with unique slug and SKUs", async () => {
    const createRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Original Bone",
        sku: "BONE-ORIGINAL",
        description: "Chew toy",
        price: "150.00",
        weightGrams: 100,
        lengthCm: "5.00",
        widthCm: "5.00",
        heightCm: "5.00"
      });

    const origId = createRes.body.data.id;

    const dupRes = await request(app)
      .post(`/api/v1/admin/products/${origId}/duplicate`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(dupRes.status).toBe(201);
    expect(dupRes.body.data.name).toBe("Original Bone Copy");
    expect(dupRes.body.data.status).toBe("draft");
    expect(dupRes.body.data.stock).toBe(0);
    expect(dupRes.body.data.sku).toBe(`BONE-ORIGINAL-COPY-${dupRes.body.data.id}`);
  });

  it("should support bulk status updates and bulk soft delete", async () => {
    const p1 = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Bulk Prod 1",
        sku: "BULK-001",
        description: "Desc",
        price: "100.00",
        weightGrams: 100,
        lengthCm: "5.00",
        widthCm: "5.00",
        heightCm: "5.00"
      });

    const p2 = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Bulk Prod 2",
        sku: "BULK-002",
        description: "Desc",
        price: "200.00",
        weightGrams: 100,
        lengthCm: "5.00",
        widthCm: "5.00",
        heightCm: "5.00"
      });

    const ids = [p1.body.data.id, p2.body.data.id];

    // Bulk status to active
    const bulkStatusRes = await request(app)
      .patch("/api/v1/admin/products/bulk-status")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productIds: ids, status: "active" });

    expect(bulkStatusRes.status).toBe(200);
    expect(bulkStatusRes.body.data.affected).toBe(2);

    // Bulk soft delete
    const bulkDeleteRes = await request(app)
      .post("/api/v1/admin/products/bulk-delete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productIds: ids });

    expect(bulkDeleteRes.status).toBe(200);
    expect(bulkDeleteRes.body.data.affected).toBe(2);
  });

  it("should list active products on storefront API with pagination and filters", async () => {
    const createRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Storefront Kibble",
        sku: "STORE-001",
        description: "Healthy kibble",
        price: "399.00",
        weightGrams: 500,
        lengthCm: "10.00",
        widthCm: "10.00",
        heightCm: "10.00"
      });

    await request(app)
      .patch(`/api/v1/admin/products/${createRes.body.data.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const listRes = await request(app).get("/api/v1/storefront/products?category=dog-food");

    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items).toHaveLength(1);
    expect(listRes.body.data.items[0].name).toBe("Storefront Kibble");

    const detailRes = await request(app).get(`/api/v1/storefront/products/${createRes.body.data.slug}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.name).toBe("Storefront Kibble");
  });
});


