/* eslint-disable */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { MediaAsset } from "../../src/database/tables/MediaAssetTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { objectStorageService } from "../../src/services/object-storage/object-storage.service.js";

describe("Media Gallery Integration", () => {
  let adminToken: string;
  let customerToken: string;
  let productAId: number;
  let productBId: number;

  async function createAccessToken(id: number, role: "admin" | "customer", email: string): Promise<string> {
    const existing = await User.findOne({ where: { email }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const user = await User.create({
      id,
      name: `Media ${role}`,
      email,
      password_hash: await PasswordService.hash("TestPass123!@#"),
      role,
      status: "active",
      reference_code: `MEDIA-${id}`
    });
    const sessionType = role === "customer" ? "customer" : "admin";
    const { session } = await SessionService.createSession(user.id, sessionType, null, null);
    return TokenService.generateAccessToken({
      sub: String(user.id),
      sessionId: String(session.id),
      role,
      sessionType
    });
  }

  beforeAll(async () => {
    await connectDatabase();
    adminToken = await createAccessToken(99450, "admin", "media-test-admin@example.com");
    customerToken = await createAccessToken(99451, "customer", "media-test-customer@example.com");
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await MediaAsset.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (transaction) => {
      const id = await IdSequenceService.allocateNextId("categories", transaction);
      return await Category.create(
        { id, name: "Grooming", slug: "grooming", description: "Pet grooming products", pet_type: "all", active: true, display_order: 1 },
        { transaction }
      );
    });

    const productA = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId: category.id, name: "Shampoo Bottle", sku: "MEDIA-SHAMPOO-001", description: "Pet shampoo", price: "299.00" });
    productAId = productA.body.data.id;

    const productB = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId: category.id, name: "Conditioner Bottle", sku: "MEDIA-COND-001", description: "Pet conditioner", price: "349.00" });
    productBId = productB.body.data.id;
  });

  function verifiedUpload(key: string, sizeBytes = 2048) {
    return { r2Key: key, publicUrl: `https://images.mypetmart.test/${key}`, contentType: "image/jpeg", sizeBytes };
  }

  async function uploadMediaAsset(key = `media/2026/08/10/${randomUUID()}.jpg`) {
    vi.spyOn(objectStorageService, "verifyMediaAssetUpload").mockResolvedValueOnce(verifiedUpload(key));
    const response = await request(app)
      .post("/api/v1/admin/media/uploads/complete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ uploadToken: "opaque-signed-upload-token-that-is-long-enough", originalFilename: "banner.jpg", altText: "Banner", title: "Hero banner" });
    return response;
  }

  it("presigns an upload authorization for an admin", async () => {
    const key = "media/2026/08/10/11111111-1111-4111-8111-111111111111.jpg";
    vi.spyOn(objectStorageService, "presignMediaAssetUpload").mockResolvedValue({
      uploadUrl: "https://r2.example.test/signed-upload?signature=opaque",
      method: "PUT",
      requiredHeaders: { "Content-Type": "image/jpeg" },
      r2Key: key,
      publicUrl: `https://images.mypetmart.test/${key}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      uploadToken: "opaque-signed-upload-token-that-is-long-enough"
    });

    const response = await request(app)
      .post("/api/v1/admin/media/uploads/presign")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ originalFilename: "banner.jpg", contentType: "image/jpeg", sizeBytes: 2048 });

    expect(response.status).toBe(200);
    expect(response.body.data.r2Key).toBe(key);
    expect(response.body.data).not.toHaveProperty("secretAccessKey");
  });

  it("rejects an unsupported file type before presigning", async () => {
    const response = await request(app)
      .post("/api/v1/admin/media/uploads/presign")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ originalFilename: "banner.gif", contentType: "image/gif", sizeBytes: 2048 });
    expect(response.status).toBe(415);
    expect(response.body.error.code).toBe("IMAGE_TYPE_NOT_ALLOWED");
  });

  it("blocks an unauthenticated request from presigning or listing", async () => {
    const presign = await request(app)
      .post("/api/v1/admin/media/uploads/presign")
      .send({ originalFilename: "banner.jpg", contentType: "image/jpeg", sizeBytes: 2048 });
    expect(presign.status).toBe(401);

    const list = await request(app).get("/api/v1/admin/media");
    expect(list.status).toBe(401);
  });

  it("forbids a Customer session from uploading to the Media Gallery", async () => {
    const response = await request(app)
      .post("/api/v1/admin/media/uploads/presign")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ originalFilename: "banner.jpg", contentType: "image/jpeg", sizeBytes: 2048 });
    expect(response.status).toBe(401);
  });

  it("completes an upload into DB metadata after R2 verification", async () => {
    const key = "media/2026/08/10/22222222-2222-4222-8222-222222222222.jpg";
    const response = await uploadMediaAsset(key);

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({
      storageKey: key,
      originalName: "banner.jpg",
      altText: "Banner",
      title: "Hero banner",
      usageCount: 0
    });
    expect(await MediaAsset.count()).toBe(1);
  });

  it("lists and searches uploaded assets", async () => {
    await uploadMediaAsset();

    vi.spyOn(objectStorageService, "verifyMediaAssetUpload").mockResolvedValueOnce(
      verifiedUpload(`media/2026/08/10/${randomUUID()}.jpg`)
    );
    await request(app)
      .post("/api/v1/admin/media/uploads/complete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ uploadToken: "second-opaque-upload-token-that-is-long-enough", originalFilename: "leash-hero.jpg", altText: "Leash hero" });

    const all = await request(app).get("/api/v1/admin/media").set("Authorization", `Bearer ${adminToken}`);
    expect(all.status).toBe(200);
    expect(all.body.data.total).toBe(2);

    const searched = await request(app)
      .get("/api/v1/admin/media?search=leash")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(searched.status).toBe(200);
    expect(searched.body.data.total).toBe(1);
    expect(searched.body.data.items[0].originalName).toBe("leash-hero.jpg");
  });

  it("attaches an existing Media Asset to a Product without a new R2 upload", async () => {
    const uploaded = await uploadMediaAsset();
    const mediaAssetId = uploaded.body.data.id;
    const presignSpy = vi.spyOn(objectStorageService, "presignMediaAssetUpload");

    const attached = await request(app)
      .post(`/api/v1/admin/products/${productAId}/images/attach-from-gallery`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId });

    expect(attached.status).toBe(201);
    expect(attached.body.data).toMatchObject({ mediaAssetId, isPrimary: true, url: uploaded.body.data.url });
    expect(presignSpy).not.toHaveBeenCalled();
  });

  it("reuses the same Media Asset across multiple Products without duplicating the R2 upload", async () => {
    const uploaded = await uploadMediaAsset();
    const mediaAssetId = uploaded.body.data.id;

    const first = await request(app)
      .post(`/api/v1/admin/products/${productAId}/images/attach-from-gallery`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId });
    const second = await request(app)
      .post(`/api/v1/admin/products/${productBId}/images/attach-from-gallery`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.data.url).toBe(second.body.data.url);
    expect(await MediaAsset.count()).toBe(1);
    expect(await ProductImage.count({ where: { media_asset_id: mediaAssetId } })).toBe(2);

    const detail = await request(app).get(`/api/v1/admin/media/${mediaAssetId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.usageCount).toBe(2);
  });

  it("blocks deleting a Media Asset that is still attached to a Product, and returns usage info", async () => {
    const uploaded = await uploadMediaAsset();
    const mediaAssetId = uploaded.body.data.id;
    await request(app)
      .post(`/api/v1/admin/products/${productAId}/images/attach-from-gallery`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId });

    const response = await request(app).delete(`/api/v1/admin/media/${mediaAssetId}`).set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe("MEDIA_ASSET_IN_USE");
    expect(response.body.error.details).toMatchObject({ usageCount: 1, productIds: [productAId] });
    expect(await MediaAsset.findByPk(mediaAssetId)).not.toBeNull();
  });

  it("deletes an unused Media Asset's metadata and its R2 object", async () => {
    const uploaded = await uploadMediaAsset();
    const mediaAssetId = uploaded.body.data.id;
    const deleteObject = vi.spyOn(objectStorageService, "deleteMediaAssetObject").mockResolvedValue();
    vi.spyOn(objectStorageService, "ensureConfigured").mockReturnValue();

    const response = await request(app).delete(`/api/v1/admin/media/${mediaAssetId}`).set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledWith(uploaded.body.data.storageKey);
    expect(await MediaAsset.findByPk(mediaAssetId)).toBeNull();
  });

  it("deleting a Product Image that reuses a Media Asset never deletes the shared R2 object", async () => {
    const uploaded = await uploadMediaAsset();
    const mediaAssetId = uploaded.body.data.id;
    const attached = await request(app)
      .post(`/api/v1/admin/products/${productAId}/images/attach-from-gallery`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId });
    const deleteProductImageObject = vi.spyOn(objectStorageService, "deleteProductImageObject");

    const response = await request(app)
      .delete(`/api/v1/admin/products/${productAId}/images/${attached.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(deleteProductImageObject).not.toHaveBeenCalled();
    expect(await ProductImage.findByPk(attached.body.data.id)).toBeNull();
    // The Media Asset itself, and the Product image slot it can still fill for another Product, survive.
    expect(await MediaAsset.findByPk(mediaAssetId)).not.toBeNull();
  });
});
