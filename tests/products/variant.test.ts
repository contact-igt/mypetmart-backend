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

describe("Stage 13 — Product Variants Integration Tests", () => {
  let adminToken: string;
  let categoryId: number;
  let productId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "var-test-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99202,
      name: "Var Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099202"
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
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (t) => {
      const catId = await IdSequenceService.allocateNextId("categories", t);
      return await Category.create(
        {
          id: catId,
          name: "Cat Toys",
          slug: "cat-toys",
          description: "Cat toys category",
          pet_type: "cat",
          active: true,
          display_order: 1
        },
        { transaction: t }
      );
    });
    categoryId = category.id;

    // Create a variant product
    const createProdRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Interactive Cat Wand",
        sku: "WAND-MASTER",
        description: "Fun wand for cats",
        petType: "cat",
        hasVariants: true,
        weightGrams: 50,
        lengthCm: "30.00",
        widthCm: "5.00",
        heightCm: "5.00"
      });

    productId = createProdRes.body.data.id;
  });

  it("should create a variant and automatically update parent price/stock aggregates", async () => {
    const var1 = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Feather Attachment",
        sku: "WAND-FEATHER",
        price: "199.00",
        compareAtPrice: "249.00",
        stock: 15
      });

    expect(var1.status).toBe(201);
    expect(var1.body.data.name).toBe("Feather Attachment");

    // Verify parent aggregates updated
    const parentRes = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(parentRes.body.data.price).toBe("199.00");
    expect(parentRes.body.data.compareAtPrice).toBe("249.00");
    expect(parentRes.body.data.stock).toBe(15);

    // Add a cheaper variant
    await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Ribbon Attachment",
        sku: "WAND-RIBBON",
        price: "149.00",
        compareAtPrice: "179.00",
        stock: 10
      });

    const parentRes2 = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(parentRes2.body.data.price).toBe("149.00"); // Minimum variant price
    expect(parentRes2.body.data.compareAtPrice).toBe("179.00"); // Linked compare price
    expect(parentRes2.body.data.stock).toBe(25); // Sum of stocks
  });

  it("should protect active products from deactivating or deleting their final active variant", async () => {
    // Add one variant
    const var1 = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Only Variant",
        sku: "WAND-ONLY",
        price: "199.00",
        stock: 5
      });

    const variantId = var1.body.data.id;

    // Activate the product
    await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    // Attempt deactivating the only active variant -> expect 422
    const deactRes = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });

    expect(deactRes.status).toBe(422);
    expect(deactRes.body.error.code).toBe("LAST_ACTIVE_VARIANT_PROTECTION");

    // Attempt deleting the only active variant -> expect 422
    const deleteRes = await request(app)
      .delete(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(deleteRes.status).toBe(422);
    expect(deleteRes.body.error.code).toBe("LAST_ACTIVE_VARIANT_PROTECTION");
  });

  it("should enforce variant parent ownership validation", async () => {
    // Create another product
    const otherProdRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Other Product",
        sku: "OTHER-PROD",
        description: "Desc",
        hasVariants: true
      });

    const otherProdId = otherProdRes.body.data.id;

    const var1 = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Var 1",
        sku: "VAR-1",
        price: "100.00"
      });

    const variantId = var1.body.data.id;

    // Attempt mutating variant 1 under otherProdId -> 404
    const updateRes = await request(app)
      .patch(`/api/v1/admin/products/${otherProdId}/variants/${variantId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ price: "200.00" });

    expect(updateRes.status).toBe(404);
  });

  it("should persist every editable Variant field and preserve untouched fields on partial updates", async () => {
    const created = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Small",
        sku: "TEST-COLLAR-S",
        price: "299.00",
        compareAtPrice: "349.00",
        stock: 5,
        active: true,
        weightGrams: 60,
        lengthCm: "12.00",
        widthCm: "3.00",
        heightCm: "2.00"
      });
    expect(created.status).toBe(201);
    const variantId = created.body.data.id;

    const updated = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Small / Red",
        sku: "TEST-COLLAR-SMALL-01",
        price: "329.00",
        compareAtPrice: "399.00",
        stock: 10,
        active: false,
        weightGrams: 75,
        lengthCm: "13.50",
        widthCm: "3.50",
        heightCm: "2.50"
      });

    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({
      id: variantId,
      productId,
      name: "Small / Red",
      sku: "TEST-COLLAR-SMALL-01",
      price: "329.00",
      compareAtPrice: "399.00",
      stock: 10,
      active: false,
      weightGrams: 75,
      lengthCm: "13.50",
      widthCm: "3.50",
      heightCm: "2.50"
    });

    const persisted = await ProductVariant.findByPk(variantId);
    expect(persisted).toMatchObject({
      name: "Small / Red",
      sku: "TEST-COLLAR-SMALL-01",
      price: "329.00",
      compare_at_price: "399.00",
      stock: 10,
      active: false,
      weight_grams: 75,
      length_cm: "13.50",
      width_cm: "3.50",
      height_cm: "2.50"
    });

    const cleared = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ stock: 0, weightGrams: null, lengthCm: null, widthCm: null, heightCm: null });

    expect(cleared.status).toBe(200);
    expect(cleared.body.data).toMatchObject({
      name: "Small / Red",
      sku: "TEST-COLLAR-SMALL-01",
      price: "329.00",
      compareAtPrice: "399.00",
      stock: 0,
      active: false,
      weightGrams: null,
      lengthCm: null,
      widthCm: null,
      heightCm: null
    });

    const detail = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.variants).toContainEqual(expect.objectContaining({
      id: variantId,
      name: "Small / Red",
      sku: "TEST-COLLAR-SMALL-01",
      price: "329.00",
      compareAtPrice: "399.00",
      stock: 0,
      active: false,
      weightGrams: null,
      lengthCm: null,
      widthCm: null,
      heightCm: null
    }));

    const conflict = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Medium", sku: "TEST-COLLAR-M", price: "349.00", stock: 8 });
    expect(conflict.status).toBe(201);

    const duplicateSku = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ sku: "TEST-COLLAR-M" });
    expect(duplicateSku.status).toBe(409);
    expect(duplicateSku.body.error.code).toBe("PRODUCT_VARIANT_SKU_CONFLICT");
    expect((await ProductVariant.findByPk(variantId))?.sku).toBe("TEST-COLLAR-SMALL-01");
  });

  it("should reorder variants deterministically", async () => {
    const v1 = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "V1", sku: "SKU-V1", price: "100.00" });

    const v2 = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "V2", sku: "SKU-V2", price: "200.00" });

    const v1Id = v1.body.data.id;
    const v2Id = v2.body.data.id;

    const reorderRes = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [v2Id, v1Id] });

    expect(reorderRes.status).toBe(200);
    expect(reorderRes.body.data[0].id).toBe(v2Id);
    expect(reorderRes.body.data[1].id).toBe(v1Id);

    const partial = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [v1Id] });
    expect(partial.status).toBe(400);
    expect(partial.body.error.code).toBe("INVALID_PRODUCT_DATA");
  });

  it("should reject a zero Variant price with a structured error and preserve the existing price", async () => {
    const created = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Positive Price", sku: "WAND-POSITIVE", price: "199.00", stock: 5 });
    expect(created.status).toBe(201);

    const rejectedCreate = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Zero Price", sku: "WAND-ZERO", price: "0.00", stock: 5 });
    expect(rejectedCreate.status).toBe(400);
    expect(rejectedCreate.body.error.code).toBe("AUTH_VALIDATION_FAILED");

    const rejectedEdit = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ price: "0.00" });
    expect(rejectedEdit.status).toBe(400);
    expect(rejectedEdit.body.error.code).toBe("AUTH_VALIDATION_FAILED");
    expect((await ProductVariant.findByPk(created.body.data.id))?.price).toBe("199.00");
  });

  it("should validate Variant compare price against the persisted effective price", async () => {
    const created = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Compared", sku: "WAND-COMPARED", price: "100.00", compareAtPrice: "150.00" });

    const response = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ price: "200.00" });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe("INVALID_PRODUCT_DATA");
    expect((await ProductVariant.findByPk(created.body.data.id))?.price).toBe("100.00");
  });

  it("should allow creating a Variant with blank shipping measurements under an active Product", async () => {
    await request(app)
      .patch(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ weightGrams: null, lengthCm: null, widthCm: null, heightCm: null });

    await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Shipping-ready Variant",
        sku: "WAND-READY",
        price: "199.00",
        weightGrams: 50,
        lengthCm: "30.00",
        widthCm: "5.00",
        heightCm: "5.00"
      });

    await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    // Shipping measurements are optional at Product/Variant activation —
    // this Variant carries none of its own and none from the Product default.
    const createRes = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Unmeasured Variant", sku: "WAND-UNMEASURED", price: "149.00" });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.weightGrams).toBeNull();
    expect(await ProductVariant.count({ where: { product_id: productId, sku: "WAND-UNMEASURED" } })).toBe(1);
  });

  it("should allow clearing a Variant's shipping override while the Product is active", async () => {
    await request(app)
      .patch(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ weightGrams: null, lengthCm: null, widthCm: null, heightCm: null });

    const variantRes = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Override Variant",
        sku: "WAND-OVERRIDE",
        price: "199.00",
        weightGrams: 50,
        lengthCm: "30.00",
        widthCm: "5.00",
        heightCm: "5.00"
      });
    const variantId = variantRes.body.data.id;

    await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const updateRes = await request(app)
      .patch(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ weightGrams: null });

    expect(updateRes.status).toBe(200);
    expect((await ProductVariant.findByPk(variantId))?.weight_grams).toBeNull();
  });

  it("should allow clearing a Product's shipping defaults while active Variants inherit from them", async () => {
    const variantRes = await request(app)
      .post(`/api/v1/admin/products/${productId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ name: "Inherited Variant", sku: "WAND-INHERITED", price: "199.00" });
    expect(variantRes.status).toBe(201);

    await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const updateRes = await request(app)
      .patch(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ weightGrams: null });

    expect(updateRes.status).toBe(200);
    expect((await Product.findByPk(productId))?.weight_grams).toBeNull();
  });

  it("should maintain 0.00 price cache for draft product with zero active variants and block activation", async () => {
    // Create draft variant product
    const draftProd = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Draft Zero Var Product",
        sku: "ZERO-VAR-PROD",
        description: "Draft test",
        hasVariants: true,
        weightGrams: 500,
        lengthCm: "10.00",
        widthCm: "10.00",
        heightCm: "10.00"
      });

    const draftProdId = draftProd.body.data.id;

    // Initially 0 active variants -> cache price is "0.00"
    expect(draftProd.body.data.price).toBe("0.00");
    expect(draftProd.body.data.compareAtPrice).toBe(null);
    expect(draftProd.body.data.stock).toBe(0);

    // Create 1 active variant
    const varRes = await request(app)
      .post(`/api/v1/admin/products/${draftProdId}/variants`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        name: "Single Variant",
        sku: "ZERO-VAR-SKU-1",
        price: "399.00",
        stock: 5
      });

    const varId = varRes.body.data.id;

    // Verify parent cache updated to 399.00
    const updatedProd1 = await request(app)
      .get(`/api/v1/admin/products/${draftProdId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(updatedProd1.body.data.price).toBe("399.00");
    expect(updatedProd1.body.data.stock).toBe(5);

    // Deactivate variant while product is still draft
    await request(app)
      .patch(`/api/v1/admin/products/${draftProdId}/variants/${varId}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });

    // Verify cache resets to 0.00, compareAtPrice null, stock 0
    const updatedProd2 = await request(app)
      .get(`/api/v1/admin/products/${draftProdId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(updatedProd2.body.data.price).toBe("0.00");
    expect(updatedProd2.body.data.compareAtPrice).toBe(null);
    expect(updatedProd2.body.data.stock).toBe(0);

    // Attempt to activate zero-variant product -> expect 422
    const actRes = await request(app)
      .patch(`/api/v1/admin/products/${draftProdId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    expect(actRes.status).toBe(422);
  });
});


