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

describe("Product Specifications — Backend Integration Tests", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "prod-specification-test-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99211,
      name: "Specification Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099211"
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
        sku: "SPEC-HARNESS-001",
        description: "A padded, adjustable harness",
        price: "999.00",
        compareAtPrice: "1299.00",
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
        sku: "SPEC-VARIANT-HARNESS-001",
        description: "Variant harness",
        hasVariants: true,
        status: "draft",
        variants: [{ name: "Small", sku: "SPEC-VARIANT-HARNESS-001-S", price: "899.00", stock: 5 }],
        ...overrides
      });
    expect(res.status).toBe(201);
    return res.body.data;
  }

  it("1. creates a Specification for a Product", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ label: "Material", value: "Nylon" });
    expect(res.body.data.id).toBeDefined();
    // No displayOrder was sent — falls back to the allocated row id, same
    // convention as ProductFeatureService.createFeature.
    expect(res.body.data.displayOrder).toBe(res.body.data.id);
  });

  it("2. supports multiple Specifications on one Product", async () => {
    const product = await createBaseProduct();

    for (const [label, value] of [
      ["Material", "Nylon"],
      ["Breed Size", "Medium"],
      ["Life Stage", "Adult"]
    ]) {
      const res = await request(app)
        .post(`/api/v1/admin/products/${product.id}/specifications`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ label, value });
      expect(res.status).toBe(201);
    }

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.specifications).toHaveLength(3);
  });

  it("3. label is trimmed", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "  Material  ", value: "Nylon" });

    expect(res.status).toBe(201);
    expect(res.body.data.label).toBe("Material");
  });

  it("4. value is trimmed", async () => {
    const product = await createBaseProduct();

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "  Nylon  " });

    expect(res.status).toBe(201);
    expect(res.body.data.value).toBe("Nylon");
  });

  it("5. rejects an empty label", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "   ", value: "Nylon" });
    expect(res.status).toBe(400);
  });

  it("6. rejects an empty value", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "   " });
    expect(res.status).toBe(400);
  });

  it("7. rejects a label over 80 characters", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "x".repeat(81), value: "Nylon" });
    expect(res.status).toBe(400);
  });

  it("8. rejects a value over 200 characters", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "x".repeat(201) });
    expect(res.status).toBe(400);
  });

  it("9. rejects a duplicate label on the same Product (exact match)", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Cotton" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_SPECIFICATION_LABEL");
  });

  it("10. rejects a duplicate label differing only by case/whitespace", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "  MATERIAL  ", value: "Cotton" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_SPECIFICATION_LABEL");

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.specifications).toHaveLength(1);
  });

  it("11. allows the same label on different Products", async () => {
    const productA = await createBaseProduct({ sku: "SPEC-A-001", name: "Harness A" });
    const productB = await createBaseProduct({ sku: "SPEC-B-001", name: "Harness B" });

    const resA = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });
    const resB = await request(app)
      .post(`/api/v1/admin/products/${productB.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Cotton" });

    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it("12. updates a Specification value", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/specifications/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ value: "Polyester" });

    expect(res.status).toBe(200);
    expect(res.body.data.value).toBe("Polyester");
    expect(res.body.data.label).toBe("Material");
  });

  it("13. updates a Specification label", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/specifications/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Fabric" });

    expect(res.status).toBe(200);
    expect(res.body.data.label).toBe("Fabric");
  });

  it("14. an update that would create a duplicate label is rejected", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });
    const second = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Colour", value: "Black" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/specifications/${second.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "material" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_SPECIFICATION_LABEL");
  });

  it("15. deletes a Specification", async () => {
    const product = await createBaseProduct();
    const created = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    const res = await request(app)
      .delete(`/api/v1/admin/products/${product.id}/specifications/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.specifications).toHaveLength(0);
  });

  it("16. reorders Specifications", async () => {
    const product = await createBaseProduct();
    const first = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });
    const second = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Colour", value: "Black" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/specifications/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [second.body.data.id, first.body.data.id] });

    expect(res.status).toBe(200);
    expect(res.body.data[0].id).toBe(second.body.data.id);
    expect(res.body.data[0].displayOrder).toBe(0);
    expect(res.body.data[1].id).toBe(first.body.data.id);
    expect(res.body.data[1].displayOrder).toBe(1);
  });

  it("17. rejects Specification update for a Specification belonging to a different Product", async () => {
    const productA = await createBaseProduct({ sku: "SPEC-A2-001", name: "Harness A2" });
    const productB = await createBaseProduct({ sku: "SPEC-B2-001", name: "Harness B2" });

    const created = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${productB.id}/specifications/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ value: "Hijacked" });
    expect(res.status).toBe(404);
  });

  it("18. rejects Specification delete for a Specification belonging to a different Product", async () => {
    const productA = await createBaseProduct({ sku: "SPEC-A3-001", name: "Harness A3" });
    const productB = await createBaseProduct({ sku: "SPEC-B3-001", name: "Harness B3" });

    const created = await request(app)
      .post(`/api/v1/admin/products/${productA.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    const res = await request(app)
      .delete(`/api/v1/admin/products/${productB.id}/specifications/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(404);
  });

  it("19. reject reorder that omits an existing Specification row (ownership-safe reorder)", async () => {
    const product = await createBaseProduct();
    const first = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Colour", value: "Black" });

    const res = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/specifications/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [first.body.data.id] });
    expect(res.status).toBe(400);
  });

  it("20. Product detail returns Specifications ordered by displayOrder then id", async () => {
    const product = await createBaseProduct();
    const created = await Promise.all(
      [
        ["Breed Size", "Medium"],
        ["Material", "Nylon"],
        ["Colour", "Black"]
      ].map(([label, value]) =>
        request(app)
          .post(`/api/v1/admin/products/${product.id}/specifications`)
          .set("Authorization", `Bearer ${adminToken}`)
          .send({ label, value })
      )
    );

    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/specifications/reorder`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ orderedIds: [created[2]!.body.data.id, created[0]!.body.data.id, created[1]!.body.data.id] });

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.specifications.map((s: { label: string }) => s.label)).toEqual(["Colour", "Breed Size", "Material"]);
  });

  it("21. Admin detail returns Specification ids", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.specifications[0].id).toBeDefined();
  });

  it("22. Storefront detail returns the safe shape (no id)", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon", displayOrder: 0 });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.specifications).toEqual([{ label: "Material", value: "Nylon", displayOrder: 0 }]);
  });

  it("23. Product list excludes Specifications", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const list = await request(app).get("/api/v1/storefront/products");
    expect(list.status).toBe(200);
    const item = list.body.data.items.find((entry: { id: number }) => entry.id === product.id);
    expect(item).toBeDefined();
    expect(item.specifications).toBeUndefined();
  });

  it("24. a Product with zero Specifications is valid end-to-end", async () => {
    const product = await createBaseProduct();

    const detail = await request(app)
      .get(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.specifications).toEqual([]);

    const activate = await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });
    expect(activate.status).toBe(200);

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.specifications).toEqual([]);
  });

  it("25. creates a Product with queued Specifications inline at creation time", async () => {
    const res = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "New Draft Harness With Specs",
        sku: "SPEC-NEW-001",
        description: "Created with pending Specifications",
        price: "899.00",
        status: "draft",
        specifications: [
          { label: "Material", value: "Nylon" },
          { label: "Breed Size", value: "Medium" }
        ]
      });

    expect(res.status).toBe(201);
    expect(res.body.data.specifications).toHaveLength(2);
    expect(res.body.data.specifications.map((s: { label: string }) => s.label)).toEqual(["Material", "Breed Size"]);
  });

  it("26. Specification rows survive Product soft-delete (matches Feature/Variant/Image RESTRICT behavior)", async () => {
    const product = await createBaseProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });

    const deleteRes = await request(app)
      .delete(`/api/v1/admin/products/${product.id}`)
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);

    const remaining = await ProductSpecification.count({ where: { product_id: product.id } });
    expect(remaining).toBe(1);
  });

  it("27. a Simple Product works end-to-end with Specifications", async () => {
    const product = await createBaseProduct({ price: "399.00", compareAtPrice: "499.00" });
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon" });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.specifications).toHaveLength(1);
    expect(storefront.body.data.price).toBe("399.00");
    expect(storefront.body.data.compareAtPrice).toBe("499.00");
  });

  it("28. a Variant Product works end-to-end with Specifications (Product-level, not per-Variant)", async () => {
    const product = await createVariantProduct();
    await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "Material", value: "Nylon", displayOrder: 0 });
    await request(app)
      .patch(`/api/v1/admin/products/${product.id}/status`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ status: "active" });

    const storefront = await request(app).get(`/api/v1/storefront/products/${product.slug}`);
    expect(storefront.status).toBe(200);
    expect(storefront.body.data.hasVariants).toBe(true);
    expect(storefront.body.data.specifications).toEqual([{ label: "Material", value: "Nylon", displayOrder: 0 }]);
  });

  it("29. rejects a reserved label (SKU) as a custom Specification", async () => {
    const product = await createBaseProduct();
    const res = await request(app)
      .post(`/api/v1/admin/products/${product.id}/specifications`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ label: "SKU", value: "HARNESS-001" });
    expect(res.status).toBe(400);
  });

  it("30. rejects a reserved label (Price/MRP/Stock, case-insensitive) as a custom Specification", async () => {
    const product = await createBaseProduct();
    for (const label of ["price", "MRP", "Stock"]) {
      const res = await request(app)
        .post(`/api/v1/admin/products/${product.id}/specifications`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ label, value: "x" });
      expect(res.status).toBe(400);
    }
  });
});
