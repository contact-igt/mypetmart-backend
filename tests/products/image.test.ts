/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { R2OperationFailedError } from "../../src/services/object-storage/object-storage.errors.js";
import { objectStorageService } from "../../src/services/object-storage/object-storage.service.js";

describe("Cloudflare R2 Product Image Integration", () => {
  let adminToken: string;
  let superAdminToken: string;
  let customerToken: string;
  let productId: number;

  async function createAccessToken(id: number, role: "admin" | "super_admin" | "customer", email: string): Promise<string> {
    const existing = await User.findOne({ where: { email }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const user = await User.create({
      id,
      name: `Image ${role}`,
      email,
      password_hash: await PasswordService.hash("TestPass123!@#"),
      role,
      status: "active",
      reference_code: `IMG-${id}`
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
    adminToken = await createAccessToken(99303, "admin", "img-test-admin@example.com");
    superAdminToken = await createAccessToken(99304, "super_admin", "img-test-super@example.com");
    customerToken = await createAccessToken(99305, "customer", "img-test-customer@example.com");
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
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (transaction) => {
      const id = await IdSequenceService.allocateNextId("categories", transaction);
      return await Category.create(
        { id, name: "Grooming", slug: "grooming", description: "Pet grooming products", pet_type: "all", active: true, display_order: 1 },
        { transaction }
      );
    });
    const productResponse = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId: category.id, name: "Shampoo Bottle", sku: "SHAMPOO-001", description: "Pet shampoo", price: "299.00" });
    productId = productResponse.body.data.id;
  });

  function authorizationFor(key: string) {
    return {
      uploadUrl: "https://r2.example.test/signed-upload?signature=opaque",
      method: "PUT" as const,
      requiredHeaders: { "Content-Type": "image/jpeg" },
      r2Key: key,
      publicUrl: `https://images.mypetmart.test/${key}`,
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      uploadToken: "opaque-signed-upload-token-that-is-long-enough"
    };
  }

  it.each([
    ["admin", () => adminToken],
    ["super_admin", () => superAdminToken]
  ])("allows %s to request a Product image presign", async (_role, token) => {
    const key = `products/${productId}/uploads/2026/08/10/11111111-1111-4111-8111-111111111111.jpg`;
    vi.spyOn(objectStorageService, "presignProductImageUpload").mockResolvedValue(authorizationFor(key));

    const response = await request(app)
      .post(`/api/v1/admin/products/${productId}/images/uploads/presign`)
      .set("Authorization", `Bearer ${token()}`)
      .send({ originalFilename: "front.jpg", contentType: "image/jpeg", sizeBytes: 2048 });

    expect(response.status).toBe(200);
    expect(response.body.data.r2Key).toBe(key);
    expect(response.body.data).not.toHaveProperty("secretAccessKey");
  });

  it("forbids a Customer from requesting a presign", async () => {
    const response = await request(app)
      .post(`/api/v1/admin/products/${productId}/images/uploads/presign`)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ originalFilename: "front.jpg", contentType: "image/jpeg", sizeBytes: 2048 });
    expect(response.status).toBe(401);
  });

  it("rejects invalid and missing Product IDs before presigning", async () => {
    const invalid = await request(app)
      .post("/api/v1/admin/products/not-an-id/images/uploads/presign")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ originalFilename: "front.jpg", contentType: "image/jpeg", sizeBytes: 2048 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe("INVALID_PRODUCT_ID");

    const missing = await request(app)
      .post("/api/v1/admin/products/999999999/images/uploads/presign")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ originalFilename: "front.jpg", contentType: "image/jpeg", sizeBytes: 2048 });
    expect(missing.status).toBe(404);
    expect(missing.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  it("rejects unsupported MIME and oversized uploads", async () => {
    const unsupported = await request(app)
      .post(`/api/v1/admin/products/${productId}/images/uploads/presign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ originalFilename: "front.gif", contentType: "image/gif", sizeBytes: 2048 });
    expect(unsupported.status).toBe(415);
    expect(unsupported.body.error.code).toBe("IMAGE_TYPE_NOT_ALLOWED");

    const oversized = await request(app)
      .post(`/api/v1/admin/products/${productId}/images/uploads/presign`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ originalFilename: "front.jpg", contentType: "image/jpeg", sizeBytes: 5 * 1024 * 1024 + 1 });
    expect(oversized.status).toBe(413);
    expect(oversized.body.error.code).toBe("IMAGE_TOO_LARGE");

  });

  it("attaches only verified metadata and keeps first/subsequent primary invariants", async () => {
    const firstKey = `products/${productId}/uploads/2026/08/10/11111111-1111-4111-8111-111111111111.jpg`;
    const secondKey = `products/${productId}/uploads/2026/08/10/22222222-2222-4222-8222-222222222222.jpg`;
    vi.spyOn(objectStorageService, "verifyProductImageUpload")
      .mockResolvedValueOnce({ r2Key: firstKey, publicUrl: `https://images.mypetmart.test/${firstKey}`, contentType: "image/jpeg", sizeBytes: 2048 })
      .mockResolvedValueOnce({ r2Key: secondKey, publicUrl: `https://images.mypetmart.test/${secondKey}`, contentType: "image/jpeg", sizeBytes: 4096 });

    const first = await request(app)
      .post(`/api/v1/admin/products/${productId}/images/uploads/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ uploadToken: "first-opaque-upload-token-that-is-long-enough", alt: "Shampoo front", width: 1200, height: 1200, isPrimary: false });
    const second = await request(app)
      .post(`/api/v1/admin/products/${productId}/images/uploads/complete`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ uploadToken: "second-opaque-upload-token-that-is-long-enough", alt: "Shampoo back", isPrimary: false });

    expect(first.status).toBe(201);
    expect(first.body.data).toMatchObject({ r2Key: firstKey, sizeBytes: 2048, width: 1200, height: 1200, isPrimary: true });
    expect(second.status).toBe(201);
    expect(second.body.data).toMatchObject({ r2Key: secondKey, sizeBytes: 4096, width: null, height: null, isPrimary: false });
    expect(await ProductImage.count({ where: { product_id: productId } })).toBe(2);
  });

  it("does not expose the old arbitrary metadata/external URL attachment endpoint", async () => {
    const response = await request(app)
      .post(`/api/v1/admin/products/${productId}/images`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ r2Key: "arbitrary/key.jpg", url: "https://attacker.example/image.jpg", alt: "unsafe", contentType: "image/jpeg" });
    // The second admin router's authentication boundary rejects the unmatched
    // legacy path before Express reaches the global 404 handler.
    expect(response.status).toBe(403);
    expect(await ProductImage.count()).toBe(0);
  });

  it("keeps primary switching and reorder compatible after verified attachment", async () => {
    const first = await ProductImageService.attachImage(productId, {
      r2Key: `products/${productId}/first.jpg`, url: `https://images.mypetmart.test/products/${productId}/first.jpg`, alt: "First", contentType: "image/jpeg"
    });
    const second = await ProductImageService.attachImage(productId, {
      r2Key: `products/${productId}/second.jpg`, url: `https://images.mypetmart.test/products/${productId}/second.jpg`, alt: "Second", contentType: "image/jpeg"
    });

    const primary = await request(app)
      .patch(`/api/v1/admin/products/${productId}/images/${second.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isPrimary: true, alt: "New primary" });
    expect(primary.status).toBe(200);
    expect(primary.body.data).toMatchObject({ id: second.id, isPrimary: true, alt: "New primary" });

    const reordered = await request(app)
      .patch(`/api/v1/admin/products/${productId}/images/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [second.id, first.id] });
    expect(reordered.status).toBe(200);
    expect(reordered.body.data.map((image: { id: number }) => image.id)).toEqual([second.id, first.id]);

    const partial = await request(app)
      .patch(`/api/v1/admin/products/${productId}/images/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [first.id] });
    expect(partial.status).toBe(400);
    expect(partial.body.error.code).toBe("INVALID_PRODUCT_DATA");
  });

  it("deletes metadata and object idempotently, then promotes the next image", async () => {
    const first = await ProductImageService.attachImage(productId, {
      r2Key: `products/${productId}/first.jpg`, url: `https://images.mypetmart.test/products/${productId}/first.jpg`, alt: "First", contentType: "image/jpeg"
    });
    const second = await ProductImageService.attachImage(productId, {
      r2Key: `products/${productId}/second.jpg`, url: `https://images.mypetmart.test/products/${productId}/second.jpg`, alt: "Second", contentType: "image/jpeg"
    });
    const deleteObject = vi.spyOn(objectStorageService, "deleteProductImageObject").mockResolvedValue();
    vi.spyOn(objectStorageService, "ensureConfigured").mockReturnValue();

    const response = await request(app)
      .delete(`/api/v1/admin/products/${productId}/images/${first.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(deleteObject).toHaveBeenCalledWith(productId, `products/${productId}/first.jpg`);
    expect(await ProductImage.findByPk(first.id)).toBeNull();
    expect((await ProductImage.findByPk(second.id))?.is_primary).toBe(true);
  });

  it("keeps DB deletion authoritative and primary promotion when provider deletion fails", async () => {
    const first = await ProductImageService.attachImage(productId, {
      r2Key: `products/${productId}/first.jpg`, url: `https://images.mypetmart.test/products/${productId}/first.jpg`, alt: "First", contentType: "image/jpeg"
    });
    const second = await ProductImageService.attachImage(productId, {
      r2Key: `products/${productId}/second.jpg`, url: `https://images.mypetmart.test/products/${productId}/second.jpg`, alt: "Second", contentType: "image/jpeg"
    });
    vi.spyOn(objectStorageService, "ensureConfigured").mockReturnValue();
    vi.spyOn(objectStorageService, "deleteProductImageObject").mockRejectedValue(new R2OperationFailedError("delete"));

    const response = await request(app)
      .delete(`/api/v1/admin/products/${productId}/images/${first.id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(502);
    expect(response.body.error.code).toBe("R2_OPERATION_FAILED");
    expect(await ProductImage.findByPk(first.id)).toBeNull();
    expect((await ProductImage.findByPk(first.id, { paranoid: false }))?.deleted_at).not.toBeNull();
    expect((await ProductImage.findByPk(second.id))?.is_primary).toBe(true);
  });

  it("preserves Product image metadata and R2 objects when the parent Product is trashed", async () => {
    await ProductImageService.attachImage(productId, {
      r2Key: `products/${productId}/parent-delete.jpg`,
      url: `https://images.mypetmart.test/products/${productId}/parent-delete.jpg`,
      alt: "Parent delete",
      contentType: "image/jpeg"
    });
    vi.spyOn(objectStorageService, "ensureConfigured").mockReturnValue();
    const deleteObject = vi.spyOn(objectStorageService, "deleteProductImageObject").mockResolvedValue();

    const response = await request(app)
      .delete(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(response.status).toBe(200);
    expect(deleteObject).not.toHaveBeenCalled();
    expect(await Product.findByPk(productId)).toBeNull();
    expect(await ProductImage.count({ where: { product_id: productId } })).toBe(1);
  });
});
