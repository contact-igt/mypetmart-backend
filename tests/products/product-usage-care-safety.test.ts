/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductContentBlock } from "../../src/database/tables/ProductContentBlockTable/index.js";
import { ProductFaq } from "../../src/database/tables/ProductFaqTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductSpecification } from "../../src/database/tables/ProductSpecificationTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Product Usage / Care / Safety — Backend Integration Tests", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "prod-usage-care-safety-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99212,
      name: "Usage Care Safety Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099212"
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
    await ProductSpecification.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (t) => {
      const catId = await IdSequenceService.allocateNextId("categories", t);
      return await Category.create(
        {
          id: catId,
          name: "Dog Grooming",
          slug: "dog-grooming",
          description: "Grooming supplies",
          pet_type: "dog",
          active: true,
          display_order: 1
        },
        { transaction: t }
      );
    });
    categoryId = category.id;
  });

  async function createBaseProduct(overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Adjustable Dog Harness",
        sku: "UCS-HARNESS-001",
        description: "A padded, adjustable harness",
        price: "999.00",
        status: "draft",
        ...overrides
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  async function createVariantProduct(overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Variant Dog Shampoo",
        sku: "UCS-VARIANT-SHAMPOO-001",
        description: "Variant shampoo",
        hasVariants: true,
        status: "draft",
        variants: [{ name: "250ml", sku: "UCS-VARIANT-SHAMPOO-001-S", price: "349.00", stock: 5 }],
        ...overrides
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it("1. creates a Product without any Usage/Care/Safety fields", async () => {
    const product = await createBaseProduct();
    expect(product.howToUse).toBeNull();
    expect(product.careInstructions).toBeNull();
    expect(product.safetyInfo).toBeNull();
  });

  it("2. creates a Product with howToUse", async () => {
    const product = await createBaseProduct({ howToUse: "Place the harness around your pet and secure the buckle." });
    expect(product.howToUse).toBe("Place the harness around your pet and secure the buckle.");
    expect(product.careInstructions).toBeNull();
    expect(product.safetyInfo).toBeNull();
  });

  it("3. creates a Product with careInstructions", async () => {
    const product = await createBaseProduct({ careInstructions: "Hand wash with mild detergent and air dry." });
    expect(product.careInstructions).toBe("Hand wash with mild detergent and air dry.");
  });

  it("4. creates a Product with safetyInfo", async () => {
    const product = await createBaseProduct({ safetyInfo: "Inspect straps and buckles for damage before use." });
    expect(product.safetyInfo).toBe("Inspect straps and buckles for damage before use.");
  });

  it("5. creates a Product with all three fields", async () => {
    const product = await createBaseProduct({
      howToUse: "Step 1. Step 2.",
      careInstructions: "Wipe clean after use.",
      safetyInfo: "Keep out of reach of pets when not in use."
    });
    expect(product.howToUse).toBe("Step 1. Step 2.");
    expect(product.careInstructions).toBe("Wipe clean after use.");
    expect(product.safetyInfo).toBe("Keep out of reach of pets when not in use.");
  });

  it("6. empty string normalizes to null", async () => {
    const product = await createBaseProduct({ howToUse: "", careInstructions: "", safetyInfo: "" });
    expect(product.howToUse).toBeNull();
    expect(product.careInstructions).toBeNull();
    expect(product.safetyInfo).toBeNull();
  });

  it("7. whitespace-only string normalizes to null", async () => {
    const product = await createBaseProduct({ howToUse: "   ", careInstructions: "\n\n  \t", safetyInfo: "  " });
    expect(product.howToUse).toBeNull();
    expect(product.careInstructions).toBeNull();
    expect(product.safetyInfo).toBeNull();
  });

  it("8. updates each field", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        howToUse: "Updated how-to-use text.",
        careInstructions: "Updated care text.",
        safetyInfo: "Updated safety text."
      });

    expect(res.status).toBe(200);
    expect(res.body.data.howToUse).toBe("Updated how-to-use text.");
    expect(res.body.data.careInstructions).toBe("Updated care text.");
    expect(res.body.data.safetyInfo).toBe("Updated safety text.");
  });

  it("9. clears each field to null", async () => {
    const product = await createBaseProduct({
      howToUse: "Original how-to-use.",
      careInstructions: "Original care.",
      safetyInfo: "Original safety."
    });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ howToUse: "", careInstructions: null, safetyInfo: "   " });

    expect(res.status).toBe(200);
    expect(res.body.data.howToUse).toBeNull();
    expect(res.body.data.careInstructions).toBeNull();
    expect(res.body.data.safetyInfo).toBeNull();
  });

  it("10. rejects a value over the max length", async () => {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Too Long Harness",
        sku: "UCS-TOO-LONG-001",
        description: "A harness",
        price: "999.00",
        status: "draft",
        howToUse: "x".repeat(5001)
      });
    expect(res.status).toBe(400);
  });

  it("11. Admin detail returns all three fields", async () => {
    const product = await createBaseProduct({ howToUse: "Use it well." });

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.howToUse).toBe("Use it well.");
    expect(detail.body.data.careInstructions).toBeNull();
    expect(detail.body.data.safetyInfo).toBeNull();
  });

  it("12. Storefront detail returns all three fields", async () => {
    const product = await createBaseProduct({
      howToUse: "Use it well.",
      careInstructions: "Care for it well.",
      safetyInfo: "Be safe."
    });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.howToUse).toBe("Use it well.");
    expect(storefront.body.data.careInstructions).toBe("Care for it well.");
    expect(storefront.body.data.safetyInfo).toBe("Be safe.");
  });

  it("13. Product list excludes Usage/Care/Safety fields", async () => {
    const product = await createBaseProduct({ howToUse: "Use it well." });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const list = await request(app).get("/api/v1/storefront/products");
    expect(list.status).toBe(200);
    const item = list.body.data.items.find((entry: { id: number }) => entry.id === product.id);
    expect(item).toBeDefined();
    expect(item.howToUse).toBeUndefined();
    expect(item.careInstructions).toBeUndefined();
    expect(item.safetyInfo).toBeUndefined();
  });

  it("14. Admin list excludes Usage/Care/Safety fields", async () => {
    await createBaseProduct({ howToUse: "Use it well." });

    const list = await request(app)
      .get("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items[0].howToUse).toBeUndefined();
    expect(list.body.data.items[0].careInstructions).toBeUndefined();
    expect(list.body.data.items[0].safetyInfo).toBeUndefined();
  });

  it("15. a Simple Product works end-to-end with Usage/Care/Safety", async () => {
    const product = await createBaseProduct({ howToUse: "Use it well.", price: "399.00", compareAtPrice: "499.00" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.howToUse).toBe("Use it well.");
  });

  it("16. a Variant Product works end-to-end with Usage/Care/Safety", async () => {
    const product = await createVariantProduct({ careInstructions: "Store in a cool, dry place." });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.hasVariants).toBe(true);
    expect(storefront.body.data.careInstructions).toBe("Store in a cool, dry place.");
  });

  it("17. Product activation does not require Usage/Care/Safety fields", async () => {
    const product = await createBaseProduct();
    const activate = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(activate.status).toBe(200);
  });

  it("18. duplicate Product copies Usage/Care/Safety fields", async () => {
    const product = await createBaseProduct({
      howToUse: "Use it well.",
      careInstructions: "Care for it well.",
      safetyInfo: "Be safe."
    });

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/duplicate`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.howToUse).toBe("Use it well.");
    expect(res.body.data.careInstructions).toBe("Care for it well.");
    expect(res.body.data.safetyInfo).toBe("Be safe.");
  });

  it("19. a legacy Product with null Usage/Care/Safety values remains valid end-to-end", async () => {
    const product = await createBaseProduct();
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.howToUse).toBeNull();
    expect(storefront.body.data.careInstructions).toBeNull();
    expect(storefront.body.data.safetyInfo).toBeNull();
  });
});
