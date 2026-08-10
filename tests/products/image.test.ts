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

describe("Stage 13 — Product Image Metadata Integration Tests", () => {
  let adminToken: string;
  let categoryId: number;
  let productId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "img-test-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99203,
      name: "Img Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099203"
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
          name: "Grooming",
          slug: "grooming",
          description: "Pet grooming products",
          pet_type: "all",
          active: true,
          display_order: 1
        },
        { transaction: t }
      );
    });
    categoryId = category.id;

    const prodRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Shampoo Bottle",
        sku: "SHAMPOO-001",
        description: "Pet shampoo",
        price: "299.00"
      });

    productId = prodRes.body.data.id;
  });

  it("should automatically make the first attached image primary", async () => {
    const img1 = await request(app)
      .post(`/api/v1/admin/products/${productId}/images`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        r2Key: `products/${productId}/img1.jpg`,
        url: `https://cdn.mypetmart.com/products/${productId}/img1.jpg`,
        alt: "Shampoo Front",
        contentType: "image/jpeg",
        isPrimary: false // Request false, but first image MUST become primary automatically
      });

    expect(img1.status).toBe(201);
    expect(img1.body.data.isPrimary).toBe(true);

    // Attach second image without primary
    const img2 = await request(app)
      .post(`/api/v1/admin/products/${productId}/images`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        r2Key: `products/${productId}/img2.jpg`,
        url: `https://cdn.mypetmart.com/products/${productId}/img2.jpg`,
        alt: "Shampoo Back",
        contentType: "image/jpeg",
        isPrimary: false
      });

    expect(img2.status).toBe(201);
    expect(img2.body.data.isPrimary).toBe(false);
  });

  it("should switch primary image transactionally", async () => {
    const img1 = await request(app)
      .post(`/api/v1/admin/products/${productId}/images`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        r2Key: `products/${productId}/front.jpg`,
        url: `https://cdn.mypetmart.com/products/${productId}/front.jpg`,
        alt: "Front",
        contentType: "image/jpeg"
      });

    const img2 = await request(app)
      .post(`/api/v1/admin/products/${productId}/images`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        r2Key: `products/${productId}/back.jpg`,
        url: `https://cdn.mypetmart.com/products/${productId}/back.jpg`,
        alt: "Back",
        contentType: "image/jpeg"
      });

    const img2Id = img2.body.data.id;

    // Set img2 as primary
    const updateRes = await request(app)
      .patch(`/api/v1/admin/products/${productId}/images/${img2Id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ isPrimary: true });

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.isPrimary).toBe(true);

    // Verify img1 is no longer primary
    const productDetail = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    const primaryImages = productDetail.body.data.images.filter((img: { isPrimary: boolean }) => img.isPrimary);
    expect(primaryImages).toHaveLength(1);
    expect(primaryImages[0].id).toBe(img2Id);
  });

  it("should promote next image when primary image is soft deleted", async () => {
    const img1 = await request(app)
      .post(`/api/v1/admin/products/${productId}/images`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        r2Key: `products/${productId}/1.jpg`,
        url: `https://cdn.mypetmart.com/products/${productId}/1.jpg`,
        alt: "1",
        contentType: "image/jpeg"
      });

    const img2 = await request(app)
      .post(`/api/v1/admin/products/${productId}/images`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        r2Key: `products/${productId}/2.jpg`,
        url: `https://cdn.mypetmart.com/products/${productId}/2.jpg`,
        alt: "2",
        contentType: "image/jpeg"
      });

    const img1Id = img1.body.data.id;
    const img2Id = img2.body.data.id;

    // Delete primary image (img1)
    const delRes = await request(app)
      .delete(`/api/v1/admin/products/${productId}/images/${img1Id}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(delRes.status).toBe(200);

    // Verify img2 is now promoted to primary
    const productDetail = await request(app)
      .get(`/api/v1/admin/products/${productId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(productDetail.body.data.images).toHaveLength(1);
    expect(productDetail.body.data.images[0].id).toBe(img2Id);
    expect(productDetail.body.data.images[0].isPrimary).toBe(true);
  });
});


