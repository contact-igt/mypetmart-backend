/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { ProductImageService } from "../../src/models/ProductModels/product-image.service.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Catalog rebaseline contract closure", () => {
  let adminToken: string;
  let categoryId: number;
  let skuSequence = 0;

  beforeAll(async () => {
    await connectDatabase();
    const testEmail = "catalog-closure-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }

    const adminUser = await User.create({
      id: 99205,
      name: "Catalog Closure Admin",
      email: testEmail,
      password_hash: await PasswordService.hash("TestPass123!@#"),
      role: "admin",
      status: "active",
      reference_code: "ADM-099205"
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
    await ProductImage.destroy({ where: {}, force: true });
    await ProductVariant.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (transaction) => {
      const id = await IdSequenceService.allocateNextId("categories", transaction);
      return Category.create(
        {
          id,
          name: "Closure Dog Supplies",
          slug: `closure-dog-supplies-${id}`,
          description: "Catalog closure fixtures",
          pet_type: "dog",
          active: true,
          display_order: 1
        },
        { transaction }
      );
    });
    categoryId = category.id;
  });

  async function createProduct(overrides: Record<string, unknown> = {}) {
    skuSequence += 1;
    return request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: `Closure Product ${skuSequence}`,
        sku: `CLOSURE-${skuSequence}`,
        description: "Catalog contract closure product",
        petType: "dog",
        price: "100.00",
        stock: 10,
        weightGrams: 100,
        lengthCm: "10.00",
        widthCm: "10.00",
        heightCm: "10.00",
        ...overrides
      });
  }

  it("updates simple-product price, compareAtPrice, and stock", async () => {
    const created = await createProduct();
    const response = await request(app)
      .patch(`/api/v1/admin/products/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ price: "125.50", compareAtPrice: "150.00", stock: 7 });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ price: "125.50", compareAtPrice: "150.00", stock: 7, hasVariants: false });
  });

  it.each([
    ["price", { price: "90.25" }, { price: "90.25" }],
    ["compareAtPrice", { compareAtPrice: "150.00" }, { compareAtPrice: "150.00" }],
    ["stock", { stock: 3 }, { stock: 3 }]
  ])("updates simple-product %s independently", async (_field, patchBody, expected) => {
    const created = await createProduct();
    const response = await request(app)
      .patch(`/api/v1/admin/products/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(patchBody);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject(expected);
  });

  it.each([
    ["negative price", { price: -1 }],
    ["negative stock", { stock: -1 }],
    ["fractional stock", { stock: 1.5 }],
    ["compare price below effective price", { compareAtPrice: "99.99" }],
    ["money precision beyond two decimal places", { price: "10.001" }]
  ])("rejects invalid simple-product PATCH: %s", async (_label, patchBody) => {
    const created = await createProduct();
    const response = await request(app)
      .patch(`/api/v1/admin/products/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(patchBody);

    expect(response.status).toBe(400);
    expect(["AUTH_VALIDATION_FAILED", "INVALID_PRODUCT_DATA"]).toContain(response.body.error.code);
  });

  it("keeps hasVariants immutable after creation", async () => {
    const created = await createProduct();
    const response = await request(app)
      .patch(`/api/v1/admin/products/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ hasVariants: true });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("AUTH_VALIDATION_FAILED");
  });

  it.each([
    ["price", { price: "1.00" }],
    ["compareAtPrice", { compareAtPrice: "2.00" }],
    ["stock", { stock: 999 }]
  ])("rejects direct variant-parent %s changes and preserves its cache", async (_field, patchBody) => {
    const created = await createProduct({
      hasVariants: true,
      price: undefined,
      stock: undefined,
      variants: [{ name: "Small", sku: `CLOSURE-VARIANT-${skuSequence}`, price: "45.00", compareAtPrice: "50.00", stock: 3 }]
    });
    const before = await Product.findByPk(created.body.data.id);

    const response = await request(app)
      .patch(`/api/v1/admin/products/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send(patchBody);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PRODUCT_DATA");
    const after = await Product.findByPk(created.body.data.id);
    expect({ price: after?.price, compareAtPrice: after?.compare_at_price, stock: after?.stock }).toEqual({
      price: before?.price,
      compareAtPrice: before?.compare_at_price,
      stock: before?.stock
    });
  });

  it("protects the summary endpoint with admin authentication", async () => {
    const response = await request(app).get("/api/v1/admin/products/summary");
    expect(response.status).toBe(401);
  });

  it("returns a zeroed summary from the static route for an empty catalog", async () => {
    const response = await request(app).get("/api/v1/admin/products/summary").set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ total: 0, active: 0, draft: 0, archived: 0, outOfStock: 0 });
  });

  it("summarizes active, draft, archived, and out-of-stock products while excluding soft-deleted rows", async () => {
    const active = await createProduct({ stock: 4 });
    await request(app).patch(`/api/v1/admin/products/${active.body.data.id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "active" });

    await createProduct({ stock: 0 });

    const archived = await createProduct({ stock: 0 });
    await request(app).patch(`/api/v1/admin/products/${archived.body.data.id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "archived" });

    const deleted = await createProduct({ stock: 0 });
    await request(app).delete(`/api/v1/admin/products/${deleted.body.data.id}`).set("Authorization", `Bearer ${adminToken}`);

    const response = await request(app).get("/api/v1/admin/products/summary").set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ total: 3, active: 1, draft: 1, archived: 1, outOfStock: 2 });
  });

  it("accepts the implemented admin product query parameter contract", async () => {
    await createProduct({ stock: 3 });
    const response = await request(app)
      .get(`/api/v1/admin/products?page=1&pageSize=10&search=Closure&categoryId=${categoryId}&status=draft&petType=dog&stockLevel=in_stock&sort=price&order=asc`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
  });

  it.each(["page=0", "pageSize=101", "categoryId=0", "status=published", "petType=bird", "stockLevel=empty", "sort=id", "order=sideways"])(
    "rejects invalid admin product query input: %s",
    async (query) => {
      const response = await request(app).get(`/api/v1/admin/products?${query}`).set("Authorization", `Bearer ${adminToken}`);
      expect(response.status).toBe(400);
      expect(response.body.error.code).toBe("AUTH_VALIDATION_FAILED");
    }
  );

  it.each(["0", "-1", "abc", "1.5", "9007199254740992"])("normalizes invalid product ID '%s' to a catalog 400", async (invalidId) => {
    const response = await request(app).get(`/api/v1/admin/products/${invalidId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PRODUCT_ID");
  });

  it.each(["0", "-1", "abc", "1.5", "9007199254740992"])("normalizes invalid variant ID '%s' to a catalog 400", async (invalidId) => {
    const product = await createProduct();
    const response = await request(app)
      .patch(`/api/v1/admin/products/${product.body.data.id}/variants/${invalidId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Invalid ID" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_VARIANT_ID");
  });

  it.each(["0", "-1", "abc", "1.5", "9007199254740992"])("normalizes invalid image ID '%s' to a catalog 400", async (invalidId) => {
    const product = await createProduct();
    const response = await request(app)
      .patch(`/api/v1/admin/products/${product.body.data.id}/images/${invalidId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ alt: "Invalid ID" });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_IMAGE_ID");
  });

  it("returns a structured non-leaking error when image reorder includes another product's image", async () => {
    const first = await createProduct();
    const second = await createProduct();
    const image = await ProductImageService.attachImage(second.body.data.id, {
      r2Key: `products/${second.body.data.id}/ownership.jpg`,
      url: `https://cdn.mypetmart.com/products/${second.body.data.id}/ownership.jpg`,
      alt: "Ownership fixture",
      contentType: "image/jpeg"
    });

    const response = await request(app)
      .patch(`/api/v1/admin/products/${first.body.data.id}/images/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [image.id] });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PRODUCT_DATA");
    expect(response.body.error).not.toHaveProperty("details");
  });
});
