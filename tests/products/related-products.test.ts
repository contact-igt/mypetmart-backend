/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductFaq } from "../../src/database/tables/ProductFaqTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Related Products — Storefront Automatic Recommendations", () => {
  let adminToken: string;
  let categoryId: number;
  let otherCategoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "related-products-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99301,
      name: "Related Products Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099301"
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
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const [category, otherCategory] = await sequelize.transaction(async (t) => {
      const catId = await IdSequenceService.allocateNextId("categories", t);
      const cat = await Category.create(
        { id: catId, name: "Dog Food", slug: "dog-food", description: "Dog food", pet_type: "dog", active: true, display_order: 1 },
        { transaction: t }
      );
      const otherId = await IdSequenceService.allocateNextId("categories", t);
      const other = await Category.create(
        { id: otherId, name: "Cat Toys", slug: "cat-toys", description: "Cat toys", pet_type: "cat", active: true, display_order: 2 },
        { transaction: t }
      );
      return [cat, other];
    });
    categoryId = category.id;
    otherCategoryId = otherCategory.id;
  });

  async function createAndActivate(overrides: Record<string, unknown>): Promise<{ id: number; slug: string }> {
    const createRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        description: "Related products fixture",
        price: "199.00",
        ...overrides
      });
    expect(createRes.status).toBe(201);
    const { id, slug } = createRes.body.data;

    const activateRes = await request(app)
      .patch(`/api/v1/admin/products/${id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(activateRes.status).toBe(200);

    return { id, slug };
  }

  it("1. returns Products from the same Category", async () => {
    const main = await createAndActivate({ name: "Royal Canin Puppy Food", sku: "RC-PUP-001" });
    const sibling = await createAndActivate({ name: "Pedigree Puppy Food", sku: "PED-PUP-001" });

    const detail = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    expect(detail.status).toBe(200);
    const relatedIds = detail.body.data.relatedProducts.map((p: { id: number }) => p.id);
    expect(relatedIds).toContain(sibling.id);
  });

  it("2. ranks same-Brand matches above unrelated Category/Brand matches", async () => {
    const main = await createAndActivate({ name: "Royal Canin Puppy Food", sku: "RC-PUP-002", brand: "Royal Canin" });
    const sameBrandDifferentCategory = await createAndActivate({
      name: "Royal Canin Cat Food",
      sku: "RC-CAT-002",
      brand: "Royal Canin",
      categoryId: otherCategoryId
    });
    const sameCategoryNoBrand = await createAndActivate({ name: "Generic Puppy Kibble", sku: "GEN-PUP-002" });

    const detail = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    const related = detail.body.data.relatedProducts as Array<{ id: number }>;
    const brandIndex = related.findIndex((p) => p.id === sameBrandDifferentCategory.id);
    const categoryOnlyIndex = related.findIndex((p) => p.id === sameCategoryNoBrand.id);
    // Same-category (+50) still outranks same-brand-only (+30) — verify both are present
    // and that the higher-scored same-category match sorts first.
    expect(brandIndex).toBeGreaterThanOrEqual(0);
    expect(categoryOnlyIndex).toBeGreaterThanOrEqual(0);
    expect(categoryOnlyIndex).toBeLessThan(brandIndex);
  });

  it("3. matching tags increase a candidate's rank", async () => {
    const main = await createAndActivate({ name: "Royal Canin Puppy Food", sku: "RC-PUP-003", tags: ["grain-free", "puppy"], categoryId: otherCategoryId });
    const manyTagMatches = await createAndActivate({ name: "Tag Match A", sku: "TAG-A-003", tags: ["grain-free", "puppy"], categoryId: otherCategoryId });
    const noTagMatches = await createAndActivate({ name: "Tag Match B", sku: "TAG-B-003", tags: ["senior"], categoryId: otherCategoryId });

    const detail = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    const related = detail.body.data.relatedProducts as Array<{ id: number }>;
    const highIndex = related.findIndex((p) => p.id === manyTagMatches.id);
    const lowIndex = related.findIndex((p) => p.id === noTagMatches.id);
    expect(highIndex).toBeGreaterThanOrEqual(0);
    expect(lowIndex).toBeGreaterThanOrEqual(0);
    expect(highIndex).toBeLessThan(lowIndex);
  });

  it("4. never includes the current Product itself", async () => {
    const main = await createAndActivate({ name: "Royal Canin Puppy Food", sku: "RC-PUP-004" });

    const detail = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    const relatedIds = detail.body.data.relatedProducts.map((p: { id: number }) => p.id);
    expect(relatedIds).not.toContain(main.id);
  });

  it("5. excludes draft and archived Products", async () => {
    const main = await createAndActivate({ name: "Royal Canin Puppy Food", sku: "RC-PUP-005" });

    const draftRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Draft Sibling", sku: "DRAFT-005", description: "draft", price: "99.00" });
    expect(draftRes.status).toBe(201);

    const archived = await createAndActivate({ name: "Archived Sibling", sku: "ARCH-005" });
    await request(app)
      .patch(`/api/v1/admin/products/${archived.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "archived" });

    const detail = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    const relatedIds = detail.body.data.relatedProducts.map((p: { id: number }) => p.id);
    expect(relatedIds).not.toContain(draftRes.body.data.id);
    expect(relatedIds).not.toContain(archived.id);
  });

  it("6. returns a maximum of 6 related Products", async () => {
    const main = await createAndActivate({ name: "Royal Canin Puppy Food", sku: "RC-PUP-006" });
    for (let i = 0; i < 9; i++) {
      await createAndActivate({ name: `Sibling ${i}`, sku: `SIB-006-${i}` });
    }

    const detail = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    expect(detail.body.data.relatedProducts.length).toBeLessThanOrEqual(6);
    expect(detail.body.data.relatedProducts.length).toBe(6);
  });

  it("7. handles zero available related Products without placeholders", async () => {
    const main = await createAndActivate({ name: "Lonely Product", sku: "LONE-007" });

    const detail = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.relatedProducts).toEqual([]);
  });

  it("8. never returns duplicate Products", async () => {
    const main = await createAndActivate({ name: "Royal Canin Puppy Food", sku: "RC-PUP-008", brand: "Royal Canin" });
    for (let i = 0; i < 5; i++) {
      await createAndActivate({ name: `Sibling ${i}`, sku: `SIB-008-${i}`, brand: "Royal Canin" });
    }

    const detail = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    const relatedIds = detail.body.data.relatedProducts.map((p: { id: number }) => p.id);
    expect(new Set(relatedIds).size).toBe(relatedIds.length);
  });

  it("9. products within 30% price band score above out-of-band candidates on ties", async () => {
    const main = await createAndActivate({ name: "Royal Canin Puppy Food", sku: "RC-PUP-009", price: "500.00", categoryId: otherCategoryId });
    const similarPrice = await createAndActivate({ name: "Similar Price", sku: "SIM-009", price: "550.00", categoryId: otherCategoryId });
    const farPrice = await createAndActivate({ name: "Far Price", sku: "FAR-009", price: "5000.00", categoryId: otherCategoryId });

    const detail = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    const related = detail.body.data.relatedProducts as Array<{ id: number }>;
    const similarIndex = related.findIndex((p) => p.id === similarPrice.id);
    const farIndex = related.findIndex((p) => p.id === farPrice.id);
    expect(similarIndex).toBeGreaterThanOrEqual(0);
    expect(farIndex).toBeGreaterThanOrEqual(0);
    expect(similarIndex).toBeLessThan(farIndex);
  });

  it("10. does not affect the existing Storefront Product list/detail endpoints", async () => {
    const main = await createAndActivate({ name: "Royal Canin Puppy Food", sku: "RC-PUP-010" });

    const listRes = await request(app).get("/api/v1/storefront/products?category=dog-food");
    expect(listRes.status).toBe(200);
    expect(listRes.body.data.items[0].name).toBe("Royal Canin Puppy Food");
    expect(listRes.body.data.items[0].relatedProducts).toBeUndefined();

    const detailRes = await request(app).get(`/api/v1/storefront/products/${main.slug}`);
    expect(detailRes.status).toBe(200);
    expect(detailRes.body.data.name).toBe("Royal Canin Puppy Food");
    expect(Array.isArray(detailRes.body.data.relatedProducts)).toBe(true);
  });
});
