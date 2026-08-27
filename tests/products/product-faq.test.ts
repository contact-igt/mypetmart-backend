/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductFaq } from "../../src/database/tables/ProductFaqTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductSpecification } from "../../src/database/tables/ProductSpecificationTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductContentBlock } from "../../src/database/tables/ProductContentBlockTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Product FAQs — Backend Integration Tests", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "prod-faq-test-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99311,
      name: "FAQ Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099311"
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
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await ProductSpecification.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
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

  async function createBaseProduct(overrides: Record<string, unknown> = {}) {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Adjustable Dog Harness",
        sku: "FAQ-HARNESS-001",
        description: "A padded, adjustable harness",
        price: "999.00",
        status: "draft",
        ...overrides
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  async function activate(id: number) {
    const res = await request(app)
      .patch(`/api/v1/admin/products/${id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(res.status).toBe(200);
  }

  it("1. creates a FAQ for a Product", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is this machine washable?", answer: "Yes, hand wash with mild detergent." });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ question: "Is this machine washable?", answer: "Yes, hand wash with mild detergent." });
    expect(res.body.data.id).toBeDefined();
  });

  it("2. supports multiple FAQs on one Product", async () => {
    const product = await createBaseProduct();

    for (const [question, answer] of [
      ["Is it waterproof?", "It is water-resistant, not fully waterproof."],
      ["What sizes are available?", "Small, Medium, and Large."],
      ["Does it come with a warranty?", "Yes, a 6-month manufacturing warranty."]
    ]) {
      const res = await request(app)
        .post(`/api/v1/admin/products/${product.id}/faqs`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ question, answer });
      expect(res.status).toBe(201);
    }

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.faqs).toHaveLength(3);
  });

  it("3. question is trimmed", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "  Is it waterproof?  ", answer: "Water-resistant." });
    expect(res.status).toBe(201);
    expect(res.body.data.question).toBe("Is it waterproof?");
  });

  it("4. answer is trimmed", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is it waterproof?", answer: "  Water-resistant.  " });
    expect(res.status).toBe(201);
    expect(res.body.data.answer).toBe("Water-resistant.");
  });

  it("5. rejects an empty question", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "   ", answer: "Water-resistant." });
    expect(res.status).toBe(400);
  });

  it("6. rejects an empty answer", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is it waterproof?", answer: "   " });
    expect(res.status).toBe(400);
  });

  it("7. rejects a question over 200 characters", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "x".repeat(201), answer: "Water-resistant." });
    expect(res.status).toBe(400);
  });

  it("8. rejects an answer over 2000 characters", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is it waterproof?", answer: "x".repeat(2001) });
    expect(res.status).toBe(400);
  });

  it("9. edits a FAQ's question and answer", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is it waterproof?", answer: "Water-resistant." });

    const updated = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/faqs/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is it fully waterproof?", answer: "No, only water-resistant coating." });

    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ question: "Is it fully waterproof?", answer: "No, only water-resistant coating." });
  });

  it("10. deletes a FAQ", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is it waterproof?", answer: "Water-resistant." });

    const deleted = await request(app)
      .delete(`/api/v1/admin/products/${product.id}/faqs/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleted.status).toBe(200);

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.faqs).toHaveLength(0);
  });

  it("11. reorders FAQs", async () => {
    const product = await createBaseProduct();
    const a = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Q1", answer: "A1" });
    const b = await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Q2", answer: "A2" });

    const reordered = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/faqs/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [b.body.data.id, a.body.data.id] });

    expect(reordered.status).toBe(200);
    expect(reordered.body.data[0].id).toBe(b.body.data.id);
    expect(reordered.body.data[1].id).toBe(a.body.data.id);
  });

  it("12. a FAQ scoped to another Product 404s", async () => {
    const productA = await createBaseProduct({ sku: "FAQ-A-001", name: "Harness A" });
    const productB = await createBaseProduct({ sku: "FAQ-B-001", name: "Harness B" });
    const faq = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Q1", answer: "A1" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${productB.id}/faqs/${faq.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Hijacked" });
    expect(res.status).toBe(404);
  });

  it("13. unauthenticated requests are rejected", async () => {
    const product = await createBaseProduct();
    const res = await request(app).post(`/api/v1/admin/products/${product.id}/faqs`).send({ question: "Q1", answer: "A1" });
    expect(res.status).toBe(401);
  });

  it("14. creates a Product with inline FAQs", async () => {
    const product = await createBaseProduct({
      sku: "FAQ-INLINE-001",
      faqs: [
        { question: "Is it durable?", answer: "Yes, reinforced stitching." },
        { question: "What material is used?", answer: "Ballistic nylon." }
      ]
    });
    expect(product.faqs).toHaveLength(2);
    expect(product.faqs[0].question).toBe("Is it durable?");
  });

  it("15. duplicating a Product copies its FAQs", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is it durable?", answer: "Yes, reinforced stitching." });

    const duplicated = await request(app)
      .post(`/api/v1/admin/products/${product.id}/duplicate`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(duplicated.status).toBe(201);
    expect(duplicated.body.data.faqs).toHaveLength(1);
    expect(duplicated.body.data.faqs[0].question).toBe("Is it durable?");
    expect(duplicated.body.data.id).not.toBe(product.id);
  });

  it("16. Storefront Product detail response includes FAQs (question/answer, no internal id)", async () => {
    const product = await createBaseProduct({ sku: "FAQ-STORE-001" });
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is it durable?", answer: "Yes, reinforced stitching." });
    await activate(product.id);

    const detail = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.faqs).toHaveLength(1);
    expect(detail.body.data.faqs[0]).toMatchObject({ question: "Is it durable?", answer: "Yes, reinforced stitching." });
    expect(detail.body.data.faqs[0].id).toBeUndefined();
  });

  it("17. Storefront Product list response does not include FAQs", async () => {
    const product = await createBaseProduct({ sku: "FAQ-LIST-001" });
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/faqs`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ question: "Is it durable?", answer: "Yes, reinforced stitching." });
    await activate(product.id);

    const list = await request(app).get("/api/v1/storefront/products?category=dog-harnesses");
    expect(list.status).toBe(200);
    expect(list.body.data.items[0].faqs).toBeUndefined();
  });
});
