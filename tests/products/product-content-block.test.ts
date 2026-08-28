/* eslint-disable */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { MediaAsset } from "../../src/database/tables/MediaAssetTable/index.js";
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
import { objectStorageService } from "../../src/services/object-storage/object-storage.service.js";

describe("Product Enhanced Content (ProductContentBlock) — Backend Integration Tests", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "prod-content-block-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99213,
      name: "Content Block Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099213"
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
    vi.restoreAllMocks();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await ProductSpecification.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await MediaAsset.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (t) => {
      const catId = await IdSequenceService.allocateNextId("categories", t);
      return await Category.create(
        {
          id: catId,
          name: "Dog Harnesses",
          slug: "dog-harnesses",
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

  function verifiedUpload(key: string, sizeBytes = 2048, contentType = "image/jpeg") {
    return { r2Key: key, publicUrl: `https://images.mypetmart.test/${key}`, contentType, sizeBytes };
  }

  async function uploadImageAsset(key = `media/2026/08/10/${randomUUID()}.jpg`) {
    vi.spyOn(objectStorageService, "verifyMediaAssetUpload").mockResolvedValueOnce(verifiedUpload(key));
    const response = await request(app)
      .post("/api/v1/admin/media/uploads/complete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ uploadToken: "opaque-signed-upload-token-that-is-long-enough", originalFilename: "block-image.jpg", altText: "Block image", title: "Block image" });
    return response.body.data.id as number;
  }

  async function uploadVideoAsset(key = `media/2026/08/10/${randomUUID()}.mp4`) {
    vi.spyOn(objectStorageService, "verifyMediaAssetUpload").mockResolvedValueOnce(verifiedUpload(key, 10 * 1024 * 1024, "video/mp4"));
    const response = await request(app)
      .post("/api/v1/admin/media/uploads/complete")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ uploadToken: "opaque-signed-video-upload-token-that-is-long-enough", originalFilename: "block-video.mp4", altText: "Block video" });
    return response.body.data.id as number;
  }

  async function createBaseProduct(overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Adjustable Dog Harness",
        sku: "CB-HARNESS-001",
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
        name: "Variant Dog Harness",
        sku: "CB-VARIANT-HARNESS-001",
        description: "Variant harness",
        hasVariants: true,
        status: "draft",
        variants: [{ name: "Small", sku: "CB-VARIANT-HARNESS-001-S", price: "899.00", stock: 5 }],
        ...overrides
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it("1. creates an image content block", async () => {
    const product = await createBaseProduct();
    const mediaAssetId = await uploadImageAsset();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId, heading: "Built for Everyday Comfort", description: "Soft padded construction." });

    expect(res.status).toBe(201);
    expect(res.body.data.mediaAssetId).toBe(mediaAssetId);
    expect(res.body.data.media.mediaType).toBe("image");
    expect(res.body.data.heading).toBe("Built for Everyday Comfort");
  });

  it("2. creates a video content block", async () => {
    const product = await createBaseProduct();
    const mediaAssetId = await uploadVideoAsset();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId, heading: "Designed for Daily Use", layout: "media_full" });

    expect(res.status).toBe(201);
    expect(res.body.data.media.mediaType).toBe("video");
    expect(res.body.data.layout).toBe("media_full");
  });

  it("3. creates a text-only block", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Easy to Adjust", description: "Multiple adjustment points." });

    expect(res.status).toBe(201);
    expect(res.body.data.mediaAssetId).toBeNull();
    expect(res.body.data.media).toBeNull();
    expect(res.body.data.heading).toBe("Easy to Adjust");
  });

  it("4. creates a media-only block", async () => {
    const product = await createBaseProduct();
    const mediaAssetId = await uploadImageAsset();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId });

    expect(res.status).toBe(201);
    expect(res.body.data.mediaAssetId).toBe(mediaAssetId);
    expect(res.body.data.heading).toBeNull();
    expect(res.body.data.description).toBeNull();
  });

  it("5. rejects a fully empty block", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(400);
  });

  it("6. heading is trimmed", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "  Easy to Adjust  " });

    expect(res.status).toBe(201);
    expect(res.body.data.heading).toBe("Easy to Adjust");
  });

  it("7. description is trimmed", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ description: "  Multiple adjustment points.  " });

    expect(res.status).toBe(201);
    expect(res.body.data.description).toBe("Multiple adjustment points.");
  });

  it("8. rejects a heading over 160 characters", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "x".repeat(161) });
    expect(res.status).toBe(400);
  });

  it("9. rejects a description over 5000 characters", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ description: "x".repeat(5001) });
    expect(res.status).toBe(400);
  });

  it("10. rejects an invalid layout value", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Test", layout: "media_top" });
    expect(res.status).toBe(400);
  });

  it("11. updates a block", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Original heading" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/content-blocks/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Updated heading" });

    expect(res.status).toBe(200);
    expect(res.body.data.heading).toBe("Updated heading");
  });

  it("12. replaces the Media Asset on a block", async () => {
    const product = await createBaseProduct();
    const firstAsset = await uploadImageAsset();
    const secondAsset = await uploadImageAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: firstAsset, heading: "Heading" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/content-blocks/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: secondAsset });

    expect(res.status).toBe(200);
    expect(res.body.data.mediaAssetId).toBe(secondAsset);
  });

  it("13. clears the Media Asset from a block that still has text", async () => {
    const product = await createBaseProduct();
    const mediaAssetId = await uploadImageAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId, heading: "Heading survives" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/content-blocks/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: null });

    expect(res.status).toBe(200);
    expect(res.body.data.mediaAssetId).toBeNull();
    expect(res.body.data.heading).toBe("Heading survives");
  });

  it("13b. rejects clearing the last remaining content from a block (media-only -> fully empty)", async () => {
    const product = await createBaseProduct();
    const mediaAssetId = await uploadImageAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/content-blocks/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: null });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("EMPTY_CONTENT_BLOCK");
  });

  it("14. toggles active", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Heading" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/content-blocks/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(res.body.data.active).toBe(false);
  });

  it("15. deletes a block", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Heading" });

    const res = await request(app)
      .delete(`/api/v1/admin/products/${product.id}/content-blocks/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.contentBlocks).toHaveLength(0);
  });

  it("16. reorders blocks", async () => {
    const product = await createBaseProduct();
    const first = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "First" });
    const second = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Second" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/content-blocks/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [second.body.data.id, first.body.data.id] });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(second.body.data.id);
    expect(res.body.data[0].displayOrder).toBe(0);
    expect(res.body.data[1].id).toBe(first.body.data.id);
    expect(res.body.data[1].displayOrder).toBe(1);
  });

  it("17. rejects update for a block belonging to a different Product", async () => {
    const productA = await createBaseProduct({ sku: "CB-A-001", name: "Harness A" });
    const productB = await createBaseProduct({ sku: "CB-B-001", name: "Harness B" });
    const created = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Belongs to A" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${productB.id}/content-blocks/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Hijacked" });
    expect(res.status).toBe(404);
  });

  it("18. rejects delete for a block belonging to a different Product", async () => {
    const productA = await createBaseProduct({ sku: "CB-A2-001", name: "Harness A2" });
    const productB = await createBaseProduct({ sku: "CB-B2-001", name: "Harness B2" });
    const created = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Belongs to A" });

    const res = await request(app)
      .delete(`/api/v1/admin/products/${productB.id}/content-blocks/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it("19. rejects a mediaAssetId that does not reference a real Media Asset", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId: 99999999 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("MEDIA_ASSET_NOT_FOUND");
  });

  it("20. Product detail returns ordered active blocks", async () => {
    const product = await createBaseProduct();
    const first = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "First" });
    const second = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Second" });

    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/content-blocks/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [second.body.data.id, first.body.data.id] });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.contentBlocks.map((b: { heading: string }) => b.heading)).toEqual(["Second", "First"]);
  });

  it("21. Admin detail returns inactive blocks too", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Inactive block", active: false });

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.contentBlocks).toHaveLength(1);
    expect(detail.body.data.contentBlocks[0].id).toBe(created.body.data.id);
    expect(detail.body.data.contentBlocks[0].active).toBe(false);
  });

  it("22. Storefront excludes inactive blocks", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Active block", active: true });
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Inactive block", active: false });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.contentBlocks).toHaveLength(1);
    expect(storefront.body.data.contentBlocks[0].heading).toBe("Active block");
  });

  it("23. Product list excludes contentBlocks", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Heading" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const list = await request(app).get("/api/v1/storefront/products");
    expect(list.status).toBe(200);
    const item = list.body.data.items.find((entry: { id: number }) => entry.id === product.id);
    expect(item).toBeDefined();
    expect(item.contentBlocks).toBeUndefined();

    const adminList = await request(app).get("/api/v1/admin/products").set("Authorization", `Bearer ${adminToken}`);
    expect(adminList.body.data.items[0].contentBlocks).toBeUndefined();
  });

  it("24. a Product with zero contentBlocks is valid end-to-end", async () => {
    const product = await createBaseProduct();

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.contentBlocks).toEqual([]);

    const activate = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(activate.status).toBe(200);

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.body.data.contentBlocks).toEqual([]);
  });

  it("25. creates a Product with queued content blocks inline at creation time", async () => {
    const mediaAssetId = await uploadImageAsset();
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "New Draft Harness With Blocks",
        sku: "CB-NEW-001",
        description: "Created with pending content blocks",
        price: "899.00",
        status: "draft",
        contentBlocks: [{ heading: "Built for Comfort", mediaAssetId }, { heading: "Easy to Adjust" }]
      });

    expect(res.status).toBe(201);
    expect(res.body.data.contentBlocks).toHaveLength(2);
    expect(res.body.data.contentBlocks.map((b: { heading: string }) => b.heading)).toEqual(["Built for Comfort", "Easy to Adjust"]);
    expect(res.body.data.contentBlocks[0].displayOrder).toBe(0);
    expect(res.body.data.contentBlocks[1].displayOrder).toBe(1);
  });

  it("26. duplicate Product reuses the same Media Asset (never duplicates the R2 object)", async () => {
    const mediaAssetId = await uploadImageAsset();
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId, heading: "Built for Comfort", layout: "media_right" });

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/duplicate`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(201);
    expect(res.body.data.contentBlocks).toHaveLength(1);
    expect(res.body.data.contentBlocks[0].mediaAssetId).toBe(mediaAssetId);
    expect(res.body.data.contentBlocks[0].heading).toBe("Built for Comfort");
    expect(res.body.data.contentBlocks[0].layout).toBe("media_right");

    // Both Products' blocks now reference the same Media Asset row — no new upload/object created.
    const mediaUsage = await ProductContentBlock.count({ where: { media_asset_id: mediaAssetId } });
    expect(mediaUsage).toBe(2);
  });

  it("27. Product deletion (soft-delete) leaves Content Block rows intact, matching Feature/Specification RESTRICT behavior", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Heading" });

    const deleteRes = await request(app)
      .delete(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);

    const remaining = await ProductContentBlock.count({ where: { product_id: product.id } });
    expect(remaining).toBe(1);
  });

  it("28. MediaAsset delete is blocked while referenced by a Content Block", async () => {
    const product = await createBaseProduct();
    const mediaAssetId = await uploadImageAsset();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId, heading: "Heading" });

    const res = await request(app).delete(`/api/v1/admin/media/${mediaAssetId}`).set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("MEDIA_ASSET_IN_USE");
  });

  it("29. removing a block does not delete the MediaAsset", async () => {
    const product = await createBaseProduct();
    const mediaAssetId = await uploadImageAsset();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId, heading: "Heading" });

    await request(app)
      .delete(`/api/v1/admin/products/${product.id}/content-blocks/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(await MediaAsset.findByPk(mediaAssetId)).not.toBeNull();
  });

  it("30. an image MediaAsset works end-to-end", async () => {
    const product = await createBaseProduct();
    const mediaAssetId = await uploadImageAsset();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId, heading: "Image block" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.body.data.contentBlocks[0].media.mediaType).toBe("image");
  });

  it("31. a video MediaAsset works end-to-end", async () => {
    const product = await createBaseProduct();
    const mediaAssetId = await uploadVideoAsset();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ mediaAssetId, heading: "Video block" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.body.data.contentBlocks[0].media.mediaType).toBe("video");
  });

  it("32. a Simple Product works end-to-end with content blocks", async () => {
    const product = await createBaseProduct({ price: "399.00", compareAtPrice: "499.00" });
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Heading" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.body.data.contentBlocks).toHaveLength(1);
  });

  it("33. a Variant Product works end-to-end with content blocks (Product-level)", async () => {
    const product = await createVariantProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Heading" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.body.data.hasVariants).toBe(true);
    expect(storefront.body.data.contentBlocks).toHaveLength(1);
  });

  it("34. rejects reorder that omits an existing block", async () => {
    const product = await createBaseProduct();
    const first = await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "First" });
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/content-blocks`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ heading: "Second" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/content-blocks/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [first.body.data.id] });
    expect(res.status).toBe(400);
  });
});
