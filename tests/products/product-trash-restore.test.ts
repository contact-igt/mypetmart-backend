/* eslint-disable */
import request from "supertest";
import { QueryTypes } from "sequelize";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../src/app.js";
import { sequelize, connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductContentBlock } from "../../src/database/tables/ProductContentBlockTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { ProductImageService } from "../../src/models/ProductModels/product-image.service.js";
import { objectStorageService } from "../../src/services/object-storage/object-storage.service.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Safe Product Trash and Restore", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();
    const email = "product-trash-admin@example.com";
    const existing = await User.findOne({ where: { email }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const user = await User.create({
      id: 99210,
      name: "Product Trash Admin",
      email,
      password_hash: await PasswordService.hash("TestPass123!@#"),
      role: "admin",
      status: "active",
      reference_code: "ADM-099210"
    });
    const { session } = await SessionService.createSession(user.id, "admin", null, null);
    adminToken = TokenService.generateAccessToken({
      sub: String(user.id),
      sessionId: String(session.id),
      role: "admin",
      sessionType: "admin"
    });
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await ProductImage.destroy({ where: {}, force: true });
    await ProductVariant.destroy({ where: {}, force: true });
    await ProductFeature.destroy({ where: {}, force: true });
    await ProductMediaAssignment.destroy({ where: {}, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    categoryId = await sequelize.transaction(async (transaction) => {
      const id = await IdSequenceService.allocateNextId("categories", transaction);
      await Category.create({
        id,
        name: "Trash Test Category",
        slug: "trash-test-category",
        description: "Safe Product trash tests",
        pet_type: "dog",
        active: true,
        display_order: 1
      }, { transaction });
      return id;
    });
  });

  async function createProduct(input: Record<string, unknown>) {
    return request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        description: "Safe Product trash fixture",
        petType: "dog",
        weightGrams: 250,
        lengthCm: "20.00",
        widthCm: "10.00",
        heightCm: "5.00",
        ...input
      });
  }

  it("trashes only the parent and restores the same Product without resurrecting independently deleted children", async () => {
    const created = await createProduct({
      name: "Recoverable Collar",
      sku: "RECOVERABLE-COLLAR-MASTER",
      hasVariants: true,
      featured: true,
      variants: [
        { name: "Small", sku: "RECOVERABLE-COLLAR-S", price: "299.00", stock: 5, active: true },
        { name: "Medium", sku: "RECOVERABLE-COLLAR-M", price: "349.00", stock: 8, active: true }
      ]
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.id;
    const slug = created.body.data.slug;
    const keptVariant = created.body.data.variants.find((variant: { sku: string }) => variant.sku === "RECOVERABLE-COLLAR-S") as { id: number } | undefined;
    const deletedVariant = created.body.data.variants.find((variant: { sku: string }) => variant.sku === "RECOVERABLE-COLLAR-M") as { id: number } | undefined;
    expect(keptVariant).toBeDefined();
    expect(deletedVariant).toBeDefined();
    if (!keptVariant || !deletedVariant) throw new Error("Product variants were not returned by SKU.");

    const keptImage = await ProductImageService.attachImage(productId, {
      r2Key: `products/${productId}/uploads/2026/08/11/11111111-1111-4111-8111-111111111111.png`,
      url: "https://images.example.com/kept.png",
      alt: "Recoverable collar",
      contentType: "image/png",
      sizeBytes: 100,
      width: 600,
      height: 600,
      isPrimary: true
    });
    const deletedImage = await ProductImageService.attachImage(productId, {
      r2Key: `products/${productId}/uploads/2026/08/11/22222222-2222-4222-8222-222222222222.png`,
      url: "https://images.example.com/deleted.png",
      alt: "Deleted collar view",
      contentType: "image/png",
      sizeBytes: 100,
      width: 600,
      height: 600
    });

    expect((await request(app)
      .delete(`/api/v1/admin/products/${productId}/variants/${deletedVariant.id}`)
      .set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    await (await ProductImage.findByPk(deletedImage.id))!.destroy();

    expect((await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" })).status).toBe(200);

    const deleteObject = vi.spyOn(objectStorageService, "deleteProductImageObject");
    const trashed = await request(app)
      .delete(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(trashed.status).toBe(200);
    expect(deleteObject).not.toHaveBeenCalled();

    expect((await Product.findByPk(productId, { paranoid: false }))?.deleted_at).not.toBeNull();
    expect((await ProductVariant.findByPk(keptVariant.id))?.deleted_at).toBeNull();
    expect(await ProductVariant.findByPk(deletedVariant.id)).toBeNull();
    expect((await ProductVariant.findByPk(deletedVariant.id, { paranoid: false }))?.deleted_at).not.toBeNull();
    expect((await ProductImage.findByPk(keptImage.id))?.deleted_at).toBeNull();
    expect(await ProductImage.findByPk(deletedImage.id)).toBeNull();
    expect((await ProductImage.findByPk(deletedImage.id, { paranoid: false }))?.deleted_at).not.toBeNull();

    const orphanProtectedKeys = new Set((await ProductImage.findAll({ attributes: ["r2_key"] })).map((image) => image.r2_key));
    expect(orphanProtectedKeys).toContain(keptImage.r2Key);
    expect(orphanProtectedKeys).not.toContain(deletedImage.r2Key);
    const imageExists = vi.spyOn(objectStorageService, "productImageObjectExists").mockResolvedValue(true);

    const normalList = await request(app)
      .get("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(normalList.body.data.items).toHaveLength(0);

    const deletedList = await request(app)
      .get("/api/v1/admin/products?status=deleted&search=RECOVERABLE-COLLAR-MASTER")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deletedList.status).toBe(200);
    expect(deletedList.body.data.items).toHaveLength(1);
    expect(deletedList.body.data.items[0]).toMatchObject({
      id: productId,
      slug,
      deletedAt: expect.any(String),
      restorable: true,
      restoreBlockedReason: null
    });

    expect((await request(app).get("/api/v1/storefront/products")).body.data.items).toHaveLength(0);
    expect((await request(app).get(`/api/v1/storefront/products/${slug}`)).status).toBe(404);

    const presign = vi.spyOn(objectStorageService, "presignProductImageUpload");
    const restored = await request(app)
      .patch(`/api/v1/admin/products/${productId}/restore`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({
      id: productId,
      slug,
      sku: "RECOVERABLE-COLLAR-MASTER",
      hasVariants: true,
      categoryId,
      status: "draft",
      deletedAt: null
    });
    expect(restored.body.data.variants.map((variant: { id: number }) => variant.id)).toEqual([keptVariant.id]);
    expect(restored.body.data.images.map((image: { id: number }) => image.id)).toEqual([keptImage.id]);
    expect(restored.body.data.images[0].r2Key).toBe(keptImage.r2Key);
    expect(imageExists).toHaveBeenCalledWith(productId, keptImage.r2Key);
    expect(presign).not.toHaveBeenCalled();
    expect((await Product.findByPk(productId))?.status).toBe("draft");
    expect(await ProductVariant.findByPk(deletedVariant.id)).toBeNull();
    expect(await ProductImage.findByPk(deletedImage.id)).toBeNull();

    const reservations = await sequelize.query<{ sku: string; entity_type: string; entity_id: number }>(
      "SELECT `sku`, `entity_type`, `entity_id` FROM `catalog_sku_reservations` ORDER BY `sku`",
      { type: QueryTypes.SELECT }
    );
    expect(reservations).toEqual(expect.arrayContaining([
      expect.objectContaining({ sku: "RECOVERABLE-COLLAR-MASTER", entity_type: "product", entity_id: productId }),
      expect.objectContaining({ sku: "RECOVERABLE-COLLAR-S", entity_type: "variant", entity_id: keptVariant.id }),
      expect.objectContaining({ sku: "RECOVERABLE-COLLAR-M", entity_type: "variant", entity_id: deletedVariant.id })
    ]));

    expect((await request(app).get("/api/v1/storefront/products")).body.data.items).toHaveLength(0);
    expect((await request(app).get(`/api/v1/storefront/products/${slug}`)).status).toBe(404);
  });

  it("supports authoritative deleted search, deterministic sorting, and pagination without polluting normal status filters", async () => {
    for (const [name, sku] of [["Trash Charlie", "TRASH-C"], ["Trash Alpha", "TRASH-A"], ["Trash Bravo", "TRASH-B"]]) {
      const created = await createProduct({ name, sku, hasVariants: false, price: "199.00", stock: 1 });
      expect(created.status).toBe(201);
      expect((await request(app)
        .delete(`/api/v1/admin/products/${created.body.data.id}`)
        .set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    }

    const deleted = await request(app)
      .get("/api/v1/admin/products?status=deleted&search=Trash&sort=name&order=ASC&page=1&pageSize=2")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);
    expect(deleted.body.data).toMatchObject({ total: 3, page: 1, pageSize: 2, totalPages: 2 });
    expect(deleted.body.data.items.map((item: { name: string }) => item.name)).toEqual(["Trash Alpha", "Trash Bravo"]);
    expect(deleted.body.data.items.every((item: { deletedAt: string | null; restorable: boolean; restoreBlockedReason: string | null }) => item.deletedAt && item.restorable && item.restoreBlockedReason === null)).toBe(true);

    const reloaded = await request(app)
      .get("/api/v1/admin/products?status=deleted&search=Trash&sort=name&order=ASC&page=1&pageSize=2")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(reloaded.body.data.items.map((item: { id: number; restorable: boolean }) => [item.id, item.restorable]))
      .toEqual(deleted.body.data.items.map((item: { id: number; restorable: boolean }) => [item.id, item.restorable]));

    const secondPage = await request(app)
      .get("/api/v1/admin/products?status=deleted&search=Trash&sort=name&order=ASC&page=2&pageSize=2")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(secondPage.body.data.items.map((item: { name: string }) => item.name)).toEqual(["Trash Charlie"]);

    for (const status of [undefined, "draft", "active", "archived"]) {
      const query = status ? `?status=${status}` : "";
      const result = await request(app).get(`/api/v1/admin/products${query}`).set("Authorization", `Bearer ${adminToken}`);
      expect(result.body.data.items).toHaveLength(0);
    }
  });

  it("rejects invalid, missing, non-deleted, and legacy cascade restore requests with structured errors", async () => {
    const created = await createProduct({
      name: "Legacy Variant Product",
      sku: "LEGACY-MASTER",
      hasVariants: true,
      variants: [{ name: "Only", sku: "LEGACY-ONLY", price: "199.00", stock: 1 }]
    });
    const productId = created.body.data.id;

    const nonDeleted = await request(app)
      .patch(`/api/v1/admin/products/${productId}/restore`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(nonDeleted.status).toBe(409);
    expect(nonDeleted.body.error.code).toBe("PRODUCT_NOT_DELETED");

    const invalid = await request(app)
      .patch("/api/v1/admin/products/not-a-number/restore")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_PRODUCT_ID");

    const missing = await request(app)
      .patch("/api/v1/admin/products/999999999/restore")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("PRODUCT_NOT_FOUND");

    await sequelize.transaction(async (transaction) => {
      await ProductVariant.destroy({ where: { product_id: productId }, transaction });
      await (await Product.findByPk(productId, { transaction }))!.destroy({ transaction });
    });
    await sequelize.query("UPDATE `Products` SET `deleted_at` = ? WHERE `id` = ?", {
      replacements: ["2026-08-11 12:00:00", productId]
    });
    await sequelize.query("UPDATE `product_variants` SET `deleted_at` = ? WHERE `product_id` = ?", {
      replacements: ["2026-08-11 12:00:00", productId]
    });

    const legacyList = await request(app)
      .get("/api/v1/admin/products?status=deleted")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(legacyList.body.data.items[0]).toMatchObject({
      id: productId,
      restorable: false,
      restoreBlockedReason: expect.stringContaining("previous deletion workflow")
    });

    const legacyRestore = await request(app)
      .patch(`/api/v1/admin/products/${productId}/restore`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(legacyRestore.status).toBe(409);
    expect(legacyRestore.body.error.code).toBe("PRODUCT_LEGACY_TRASH_NOT_RESTORABLE");
    expect(await Product.findByPk(productId)).toBeNull();
    expect(await ProductVariant.findByPk(created.body.data.variants[0].id)).toBeNull();
  });

  it("restores a valid Simple Product as Draft and then persists normal activation through refresh and Storefront", async () => {
    const created = await createProduct({
      name: "Restored Active Simple",
      sku: "RESTORED-ACTIVE-SIMPLE",
      hasVariants: false,
      price: "499.00",
      stock: 12,
      status: "active"
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.id;
    const slug = created.body.data.slug;

    expect((await request(app).delete(`/api/v1/admin/products/${productId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).get(`/api/v1/storefront/products/${slug}`)).status).toBe(404);

    const deleted = await request(app)
      .get(`/api/v1/admin/products?status=deleted&search=${encodeURIComponent("RESTORED-ACTIVE-SIMPLE")}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleted.body.data.items[0]).toMatchObject({ id: productId, restorable: true, restoreBlockedReason: null });

    const restored = await request(app).patch(`/api/v1/admin/products/${productId}/restore`).set("Authorization", `Bearer ${adminToken}`);
    expect(restored.status).toBe(200);
    expect(restored.body.data).toMatchObject({ id: productId, slug, sku: "RESTORED-ACTIVE-SIMPLE", status: "draft" });
    expect((await request(app).get(`/api/v1/storefront/products/${slug}`)).status).toBe(404);

    const activated = await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(activated.status).toBe(200);
    expect(activated.body.data.status).toBe("active");

    const refreshed = await request(app).get(`/api/v1/admin/products/${productId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(refreshed.body.data.status).toBe("active");
    expect((await Product.findByPk(productId))?.status).toBe("active");
    expect((await request(app).get(`/api/v1/storefront/products/${slug}`)).status).toBe(200);
  });

  it("restores a valid Variant Product as Draft and then activates it without changing Variant identity or data", async () => {
    const created = await createProduct({
      name: "Restored Active Variant",
      sku: "RESTORED-ACTIVE-VARIANT-MASTER",
      hasVariants: true,
      status: "active",
      variants: [
        { name: "Small", sku: "RESTORED-ACTIVE-VARIANT-S", price: "599.00", stock: 4, active: true },
        { name: "Large", sku: "RESTORED-ACTIVE-VARIANT-L", price: "699.00", stock: 7, active: true }
      ]
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.id;
    const slug = created.body.data.slug;
    const originalVariants = created.body.data.variants
      .map((variant: { id: number; sku: string; name: string; price: string; stock: number; active: boolean }) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        price: variant.price,
        stock: variant.stock,
        active: variant.active
      }))
      .sort((a: { id: number }, b: { id: number }) => a.id - b.id);

    expect((await request(app).delete(`/api/v1/admin/products/${productId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    const restored = await request(app).patch(`/api/v1/admin/products/${productId}/restore`).set("Authorization", `Bearer ${adminToken}`);
    expect(restored.status).toBe(200);
    expect(restored.body.data.status).toBe("draft");

    const activated = await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(activated.status).toBe(200);
    expect(activated.body.data.status).toBe("active");
    const actualVariants = activated.body.data.variants
      .map((variant: { id: number; sku: string; name: string; price: string; stock: number; active: boolean }) => ({
        id: variant.id,
        sku: variant.sku,
        name: variant.name,
        price: variant.price,
        stock: variant.stock,
        active: variant.active
      }))
      .sort((a: { id: number }, b: { id: number }) => a.id - b.id);
    expect(actualVariants).toEqual(originalVariants);
    expect((await request(app).get(`/api/v1/admin/products/${productId}`).set("Authorization", `Bearer ${adminToken}`)).body.data.status).toBe("active");
    expect((await request(app).get(`/api/v1/storefront/products/${slug}`)).status).toBe(200);
  });

  it("keeps a restored Variant Product in Draft and returns the exact sellability error when all Variants were independently deleted", async () => {
    const created = await createProduct({
      name: "Restored Invalid Variant",
      sku: "RESTORED-INVALID-VARIANT-MASTER",
      hasVariants: true,
      variants: [{ name: "Only", sku: "RESTORED-INVALID-VARIANT-ONLY", price: "399.00", stock: 2, active: true }]
    });
    expect(created.status).toBe(201);
    const productId = created.body.data.id;
    const variantId = created.body.data.variants[0].id;

    expect((await request(app)
      .delete(`/api/v1/admin/products/${productId}/variants/${variantId}`)
      .set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).delete(`/api/v1/admin/products/${productId}`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);
    expect((await request(app).patch(`/api/v1/admin/products/${productId}/restore`).set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);

    const activation = await request(app)
      .patch(`/api/v1/admin/products/${productId}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(activation.status).toBe(422);
    expect(activation.body.error).toMatchObject({
      code: "PRODUCT_NOT_SELLABLE",
      message: "A variant product must have at least one active Variant before activation."
    });
    expect((await Product.findByPk(productId))?.status).toBe("draft");
    expect(await ProductVariant.findByPk(variantId)).toBeNull();
  });

  it("rejects corrupted historical SKU reservation ownership without changing the deleted Product", async () => {
    const created = await createProduct({ name: "SKU Conflict Restore", sku: "RESTORE-SKU-CONFLICT", hasVariants: false, price: "199.00" });
    const productId = created.body.data.id;
    expect((await request(app)
      .delete(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`)).status).toBe(200);

    await sequelize.query(
      "UPDATE `catalog_sku_reservations` SET `entity_id` = ? WHERE `sku` = ?",
      { replacements: [productId + 1000, "RESTORE-SKU-CONFLICT"] }
    );

    const deleted = await request(app)
      .get("/api/v1/admin/products?status=deleted")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleted.body.data.items[0]).toMatchObject({
      id: productId,
      restorable: false,
      restoreBlockedReason: expect.stringContaining("Historical SKU reservation ownership")
    });

    const restored = await request(app)
      .patch(`/api/v1/admin/products/${productId}/restore`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(restored.status).toBe(409);
    expect(restored.body.error.code).toBe("PRODUCT_RESTORE_SKU_CONFLICT");
    expect(await Product.findByPk(productId)).toBeNull();
    expect((await Product.findByPk(productId, { paranoid: false }))?.deleted_at).not.toBeNull();
  });
});
