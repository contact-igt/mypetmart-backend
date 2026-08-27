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
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Product Key Features — Backend Integration Tests", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "prod-feature-test-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99206,
      name: "Feature Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099206"
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
          name: "Harnesses",
          slug: "harnesses",
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
        sku: "HARNESS-001",
        description: "A padded, adjustable harness",
        price: "999.00",
        status: "draft",
        ...overrides
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it("creates a Feature for a Product", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Soft padded construction" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      productId: product.id,
      label: "Soft padded construction",
      displayOrder: 0
    });
  });

  it("supports multiple Features on one Product", async () => {
    const product = await createBaseProduct();

    for (const label of ["Soft padded construction", "Adjustable fit", "Easy to clean"]) {
      const res = await request(app)
        .post(`/api/v1/admin/products/${product.id}/features`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ label });
      expect(res.status).toBe(201);
    }

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.features).toHaveLength(3);
  });

  it("rejects an empty Feature label", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "   " });

    expect(res.status).toBe(400);
  });

  it("rejects a Feature label over 120 characters", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "x".repeat(121) });

    expect(res.status).toBe(400);
  });

  it("updates a Feature", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Lightweight design" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/features/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Ultra lightweight design" });

    expect(res.status).toBe(200);
    expect(res.body.data.label).toBe("Ultra lightweight design");
  });

  it("deletes a Feature", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Machine washable" });

    const res = await request(app)
      .delete(`/api/v1/admin/products/${product.id}/features/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.features).toHaveLength(0);
  });

  it("reorders Features", async () => {
    const product = await createBaseProduct();
    const first = await request(app)
      .post(`/api/v1/admin/products/${product.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "First" });
    const second = await request(app)
      .post(`/api/v1/admin/products/${product.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Second" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/features/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [second.body.data.id, first.body.data.id] });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(second.body.data.id);
    expect(res.body.data[0].displayOrder).toBe(0);
    expect(res.body.data[1].id).toBe(first.body.data.id);
    expect(res.body.data[1].displayOrder).toBe(1);
  });

  it("leaves Feature rows intact when the Product is soft-deleted, matching Variant/Image behavior", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Durable material" });

    // Product soft-delete leaves the FK row intact (paranoid), matching Variant/Image behavior.
    const deleteRes = await request(app)
      .delete(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);

    const remaining = await ProductFeature.count({ where: { product_id: product.id } });
    expect(remaining).toBe(1);
  });

  it("returns Features ordered by displayOrder then id on Product detail", async () => {
    const product = await createBaseProduct();
    const created = await Promise.all(
      ["Adjustable fit", "Soft padded construction", "Easy to clean"].map((label) =>
        request(app)
          .post(`/api/v1/admin/products/${product.id}/features`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ label })
      )
    );

    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/features/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [created[2]!.body.data.id, created[0]!.body.data.id, created[1]!.body.data.id] });

    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.features.map((f: { label: string }) => f.label)).toEqual([
      "Easy to clean",
      "Adjustable fit",
      "Soft padded construction"
    ]);
  });

  it("does not include Features on the Storefront Product list endpoint", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Durable material" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const list = await request(app).get("/api/v1/storefront/products");
    expect(list.status).toBe(200);
    const item = list.body.data.items.find((entry: { id: number }) => entry.id === product.id);
    expect(item).toBeDefined();
    expect(item.features).toBeUndefined();
  });

  it("keeps a Product with no Features valid end-to-end", async () => {
    const product = await createBaseProduct();

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.features).toEqual([]);

    const activate = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(activate.status).toBe(200);

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.features).toEqual([]);
  });

  it("rejects Feature update/delete for a Feature that belongs to a different Product", async () => {
    const productA = await createBaseProduct({ sku: "HARNESS-A-001", name: "Harness A" });
    const productB = await createBaseProduct({ sku: "HARNESS-B-001", name: "Harness B" });

    const created = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/features`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Belongs to Product A" });

    const updateAttempt = await request(app)
      .patch(`/api/v1/admin/products/${productB.id}/features/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Hijacked" });
    expect(updateAttempt.status).toBe(404);

    const deleteAttempt = await request(app)
      .delete(`/api/v1/admin/products/${productB.id}/features/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteAttempt.status).toBe(404);
  });

  it("creates a Product with queued Features inline at creation time", async () => {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "New Draft Harness",
        sku: "HARNESS-NEW-001",
        description: "Created with pending Features",
        price: "899.00",
        status: "draft",
        features: [{ label: "Soft padded construction" }, { label: "Adjustable fit" }]
      });

    expect(res.status).toBe(201);
    expect(res.body.data.features).toHaveLength(2);
    expect(res.body.data.features.map((f: { label: string }) => f.label)).toEqual(["Soft padded construction", "Adjustable fit"]);
  });
});
