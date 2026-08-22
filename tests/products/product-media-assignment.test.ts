/* eslint-disable */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { MediaAsset } from "../../src/database/tables/MediaAssetTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { objectStorageService } from "../../src/services/object-storage/object-storage.service.js";

describe("Product Video Assignment — Backend Integration Tests", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "prod-media-test-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99207,
      name: "Media Assignment Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099207"
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

  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(async () => {
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await MediaAsset.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (t) => {
      const catId = await IdSequenceService.allocateNextId("categories", t);
      return await Category.create(
        {
          id: catId,
          name: "Harnesses",
          slug: "harnesses-media",
          description: "Harnesses and leads",
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
        sku: `HARNESS-MEDIA-${randomUUID().slice(0, 8)}`,
        description: "A padded, adjustable harness",
        price: "999.00",
        status: "draft",
        ...overrides
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  function verifiedUpload(key: string, contentType: string, sizeBytes: number) {
    return { r2Key: key, publicUrl: `https://images.mypetmart.test/${key}`, contentType, sizeBytes };
  }

  async function createVideoAsset() {
    const key = `media/2026/08/22/${randomUUID()}.mp4`;
    vi.spyOn(objectStorageService, "verifyMediaAssetUpload").mockResolvedValueOnce(verifiedUpload(key, "video/mp4", 10 * 1024 * 1024));
    const res = await request(app)
      .post("/api/v1/admin/media/uploads/complete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ uploadToken: "opaque-signed-video-upload-token-that-is-long-enough", originalFilename: "demo.mp4", title: "Demo video" });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  async function createImageAsset() {
    const key = `media/2026/08/22/${randomUUID()}.jpg`;
    vi.spyOn(objectStorageService, "verifyMediaAssetUpload").mockResolvedValueOnce(verifiedUpload(key, "image/jpeg", 2048));
    const res = await request(app)
      .post("/api/v1/admin/media/uploads/complete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ uploadToken: "opaque-signed-image-upload-token-that-is-long-enough", originalFilename: "banner.jpg", altText: "Banner" });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it("creates a product_video assignment", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video", title: "How it works" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      mediaAssetId: video.id,
      mediaRole: "product_video",
      title: "How it works",
      active: true
    });
    expect(res.body.data.media).toMatchObject({ id: video.id, mimeType: "video/mp4", mediaType: "video" });
  });

  it("creates a testimonial_video assignment", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "testimonial_video" });

    expect(res.status).toBe(201);
    expect(res.body.data.mediaRole).toBe("testimonial_video");
  });

  it("rejects an image MediaAsset as a media assignment", async () => {
    const product = await createBaseProduct();
    const image = await createImageAsset();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: image.id, mediaRole: "product_video" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("PRODUCT_MEDIA_ASSIGNMENT_TYPE_NOT_ALLOWED");
  });

  it("rejects a missing MediaAsset", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: 999999999, mediaRole: "product_video" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEDIA_ASSET_NOT_FOUND");
  });

  it("rejects updating an assignment that belongs to a different Product", async () => {
    const productA = await createBaseProduct({ name: "Harness A" });
    const productB = await createBaseProduct({ name: "Harness B" });
    const video = await createVideoAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${productB.id}/media/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Hijacked" });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_MEDIA_ASSIGNMENT_NOT_FOUND");
  });

  it("rejects deleting an assignment that belongs to a different Product", async () => {
    const productA = await createBaseProduct({ name: "Harness A" });
    const productB = await createBaseProduct({ name: "Harness B" });
    const video = await createVideoAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });

    const res = await request(app)
      .delete(`/api/v1/admin/products/${productB.id}/media/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("PRODUCT_MEDIA_ASSIGNMENT_NOT_FOUND");
    expect(await ProductMediaAssignment.findByPk(created.body.data.id)).not.toBeNull();
  });

  it("updates an assignment's title", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video", title: "Original" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/media/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ title: "Updated title" });

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe("Updated title");
  });

  it("updates an assignment's caption", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "testimonial_video" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/media/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ caption: "A real pet parent story" });

    expect(res.status).toBe(200);
    expect(res.body.data.caption).toBe("A real pet parent story");
  });

  it("toggles an assignment's active flag", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/media/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(false);
  });

  it("deletes an assignment without deleting the underlying MediaAsset", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });

    const res = await request(app)
      .delete(`/api/v1/admin/products/${product.id}/media/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(await ProductMediaAssignment.findByPk(created.body.data.id)).toBeNull();
    expect(await MediaAsset.findByPk(video.id)).not.toBeNull();
  });

  it("blocks deleting a MediaAsset while a Product media assignment still references it", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });

    const res = await request(app).delete(`/api/v1/admin/media/${video.id}`).set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MEDIA_ASSET_IN_USE");
    expect(await MediaAsset.findByPk(video.id)).not.toBeNull();
  });

  it("allows deleting a MediaAsset once all Product media assignments are removed", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });
    await request(app)
      .delete(`/api/v1/admin/products/${product.id}/media/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const deleteObject = vi.spyOn(objectStorageService, "deleteMediaAssetObject").mockResolvedValue();
    vi.spyOn(objectStorageService, "ensureConfigured").mockReturnValue();

    const res = await request(app).delete(`/api/v1/admin/media/${video.id}`).set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(deleteObject).toHaveBeenCalled();
    expect(await MediaAsset.findByPk(video.id)).toBeNull();
  });

  it("reuses the same MediaAsset across different Products", async () => {
    const productA = await createBaseProduct({ name: "Harness A" });
    const productB = await createBaseProduct({ name: "Harness B" });
    const video = await createVideoAsset();

    const first = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });
    const second = await request(app)
      .post(`/api/v1/admin/products/${productB.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(await MediaAsset.count()).toBe(1);
    expect(await ProductMediaAssignment.count({ where: { media_asset_id: video.id } })).toBe(2);
  });

  it("reuses the same MediaAsset across different roles on the same Product", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();

    const asProductVideo = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });
    const asTestimonial = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "testimonial_video" });

    expect(asProductVideo.status).toBe(201);
    expect(asTestimonial.status).toBe(201);
    expect(await MediaAsset.count()).toBe(1);
  });

  it("returns ordered Product Videos on the detail DTO", async () => {
    const product = await createBaseProduct();
    const videoA = await createVideoAsset();
    const videoB = await createVideoAsset();
    const first = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: videoA.id, mediaRole: "product_video", title: "First" });
    const second = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: videoB.id, mediaRole: "product_video", title: "Second" });

    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/media/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaRole: "product_video", orderedIds: [second.body.data.id, first.body.data.id] });

    const detail = await request(app).get(`/api/v1/admin/products/${product.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.productVideos.map((v: { title: string }) => v.title)).toEqual(["Second", "First"]);
  });

  it("returns ordered Testimonial Videos on the detail DTO", async () => {
    const product = await createBaseProduct();
    const videoA = await createVideoAsset();
    const videoB = await createVideoAsset();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: videoA.id, mediaRole: "testimonial_video", title: "Story A" });
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: videoB.id, mediaRole: "testimonial_video", title: "Story B" });

    const detail = await request(app).get(`/api/v1/admin/products/${product.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.testimonialVideos.map((v: { title: string }) => v.title)).toEqual(["Story A", "Story B"]);
  });

  it("exposes productVideos on the Storefront/Admin detail DTO", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.productVideos).toHaveLength(1);
  });

  it("exposes testimonialVideos on the Storefront/Admin detail DTO", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "testimonial_video" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.testimonialVideos).toHaveLength(1);
  });

  it("excludes productVideos/testimonialVideos from Product list DTOs", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefrontList = await request(app).get("/api/v1/storefront/products");
    const item = storefrontList.body.data.items.find((entry: { id: number }) => entry.id === product.id);
    expect(item).toBeDefined();
    expect(item.productVideos).toBeUndefined();
    expect(item.testimonialVideos).toBeUndefined();

    const adminList = await request(app).get("/api/v1/admin/products").set("Authorization", `Bearer ${adminToken}`);
    const adminItem = adminList.body.data.items.find((entry: { id: number }) => entry.id === product.id);
    expect(adminItem.productVideos).toBeUndefined();
    expect(adminItem.testimonialVideos).toBeUndefined();
  });

  it("returns empty arrays for a Product with zero media assignments", async () => {
    const product = await createBaseProduct();

    const detail = await request(app).get(`/api/v1/admin/products/${product.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.productVideos).toEqual([]);
    expect(detail.body.data.testimonialVideos).toEqual([]);
  });

  it("matches the existing Product child-resource FK convention: assignments survive a Product soft-delete", async () => {
    const product = await createBaseProduct();
    const video = await createVideoAsset();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: video.id, mediaRole: "product_video" });

    const deleteRes = await request(app).delete(`/api/v1/admin/products/${product.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);

    const remaining = await ProductMediaAssignment.count({ where: { product_id: product.id } });
    expect(remaining).toBe(1);
  });

  it("reorder is role-safe: reordering Product Videos never touches Testimonial Videos", async () => {
    const product = await createBaseProduct();
    const productVideoA = await createVideoAsset();
    const productVideoB = await createVideoAsset();
    const testimonial = await createVideoAsset();

    const pvA = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: productVideoA.id, mediaRole: "product_video", displayOrder: 0 });
    const pvB = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: productVideoB.id, mediaRole: "product_video", displayOrder: 1 });
    const t = await request(app)
      .post(`/api/v1/admin/products/${product.id}/media`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: testimonial.id, mediaRole: "testimonial_video", displayOrder: 5 });

    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/media/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaRole: "product_video", orderedIds: [pvB.body.data.id, pvA.body.data.id] });

    const testimonialAfter = await ProductMediaAssignment.findByPk(t.body.data.id);
    expect(testimonialAfter!.display_order).toBe(5);
  });
});
