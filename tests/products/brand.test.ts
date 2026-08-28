/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductFaq } from "../../src/database/tables/ProductFaqTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Product Brand field", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "brand-test-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const adminUser = await User.create({
      id: 99460,
      name: "Brand Test Admin",
      email: testEmail,
      password_hash: await PasswordService.hash("TestPass123!@#"),
      role: "admin",
      status: "active",
      reference_code: "ADM-099460"
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
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (t) => {
      const catId = await IdSequenceService.allocateNextId("categories", t);
      return await Category.create(
        { id: catId, name: "Dog Food", slug: "dog-food", description: "Premium dog food", pet_type: "dog", active: true, display_order: 1 },
        { transaction: t }
      );
    });
    categoryId = category.id;
  });

  it("creates a Product without brand (defaults to null)", async () => {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "No Brand Kibble", sku: "NOBRAND-001", description: "Plain kibble" });

    expect(res.status).toBe(201);
    expect(res.body.data.brand).toBeNull();
  });

  it("creates a Product with a brand", async () => {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Royal Kibble", sku: "ROYAL-001", description: "Premium kibble", brand: "Royal Canin" });

    expect(res.status).toBe(201);
    expect(res.body.data.brand).toBe("Royal Canin");
  });

  it("updates a Product's brand", async () => {
    const created = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Rebrand Kibble", sku: "REBRAND-001", description: "Kibble" });
    expect(created.body.data.brand).toBeNull();

    const updated = await request(app)
      .patch(`/api/v1/admin/products/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ brand: "Pedigree" });

    expect(updated.status).toBe(200);
    expect(updated.body.data.brand).toBe("Pedigree");
  });

  it("normalizes an empty-string brand to null on create and update", async () => {
    const created = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Empty Brand Kibble", sku: "EMPTYBRAND-001", description: "Kibble", brand: "  " });
    expect(created.status).toBe(201);
    expect(created.body.data.brand).toBeNull();

    const withBrand = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Brand Then Empty", sku: "BRANDTHENEMPTY-001", description: "Kibble", brand: "Pedigree" });
    const cleared = await request(app)
      .patch(`/api/v1/admin/products/${withBrand.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ brand: "" });

    expect(cleared.status).toBe(200);
    expect(cleared.body.data.brand).toBeNull();
  });

  it("rejects a brand longer than 120 characters", async () => {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Long Brand Kibble", sku: "LONGBRAND-001", description: "Kibble", brand: "B".repeat(121) });

    expect(res.status).toBe(400);
  });

  it("returns brand in the Admin Product detail DTO", async () => {
    const created = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Detail Brand Kibble", sku: "DETAILBRAND-001", description: "Kibble", brand: "Royal Canin" });

    const detail = await request(app)
      .get(`/api/v1/admin/products/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(detail.status).toBe(200);
    expect(detail.body.data.brand).toBe("Royal Canin");
  });

  it("returns brand in the Storefront Product list and detail DTOs", async () => {
    await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Storefront Brand Kibble",
        sku: "SFBRAND-001",
        description: "Kibble",
        brand: "Royal Canin",
        status: "active",
        price: "499.00",
        stock: 10,
        weightGrams: 500,
        lengthCm: "20",
        widthCm: "15",
        heightCm: "10"
      });

    const list = await request(app).get("/api/v1/storefront/products?search=Storefront");
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].brand).toBe("Royal Canin");

    const detail = await request(app).get("/api/v1/storefront/products/storefront-brand-kibble");
    expect(detail.status).toBe(200);
    expect(detail.body.data.brand).toBe("Royal Canin");
  });

  it("finds a Product by brand via Storefront search", async () => {
    await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Searchable Kibble",
        sku: "SEARCHBRAND-001",
        description: "Kibble",
        brand: "UniqueBrandXyz",
        status: "active",
        price: "399.00",
        stock: 5,
        weightGrams: 400,
        lengthCm: "18",
        widthCm: "12",
        heightCm: "8"
      });

    const res = await request(app).get("/api/v1/storefront/products?search=UniqueBrandXyz");
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0].name).toBe("Searchable Kibble");
  });

  it("preserves brand on a Variant Product", async () => {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Variant Brand Food",
        sku: "VARBRAND-MASTER",
        description: "Kibble",
        brand: "Royal Canin",
        hasVariants: true,
        variants: [{ name: "1kg", sku: "VARBRAND-1KG", price: "299.00" }]
      });

    expect(res.status).toBe(201);
    expect(res.body.data.hasVariants).toBe(true);
    expect(res.body.data.brand).toBe("Royal Canin");
  });

  it("preserves brand when duplicating a Product", async () => {
    const created = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Duplicate Brand Kibble", sku: "DUPBRAND-001", description: "Kibble", brand: "Royal Canin" });

    const duplicated = await request(app)
      .post(`/api/v1/admin/products/${created.body.data.id}/duplicate`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(duplicated.status).toBe(201);
    expect(duplicated.body.data.brand).toBe("Royal Canin");
  });

  it("keeps existing Products (brand = NULL) valid and unaffected", async () => {
    const legacy = await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId("products", t);
      return await Product.create(
        { id, category_id: categoryId, name: "Legacy Product", slug: "legacy-product", sku: "LEGACY-001", description: "Pre-brand product", price: "199.00", status: "active" },
        { transaction: t }
      );
    });

    const detail = await request(app)
      .get(`/api/v1/admin/products/${legacy.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.brand).toBeNull();
  });
});
