/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { QueryTypes } from "sequelize";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

describe("Stage 13 — SKU Cross-Table Concurrency & Collision Tests", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();

    const testEmail = "sku-test-admin@example.com";
    const existing = await User.findOne({ where: { email: testEmail }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const adminUser = await User.create({
      id: 99204,
      name: "SKU Admin",
      email: testEmail,
      password_hash: pwdHash,
      role: "admin",
      status: "active",
      reference_code: "ADM-099204"
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
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (t) => {
      const catId = await IdSequenceService.allocateNextId("categories", t);
      return await Category.create(
        {
          id: catId,
          name: "Collars",
          slug: "collars",
          description: "Pet collars",
          pet_type: "all",
          active: true,
          display_order: 1
        },
        { transaction: t }
      );
    });
    categoryId = category.id;
  });

  it("should prevent cross-table SKU collision between Product and Variant under concurrent requests", async () => {
    // Pre-create parent product for variant test
    const parentRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        categoryId,
        name: "Parent Product",
        sku: "PARENT-MASTER-SKU",
        description: "Parent product",
        hasVariants: true
      });

    const parentId = parentRes.body.data.id;
    const testSku = "SHARED-COLLISION-SKU";

    // Launch concurrent requests: Request A creates simple Product with testSku; Request B creates Variant under parentId with testSku
    const [resA, resB] = await Promise.all([
      request(app)
        .post("/api/v1/admin/products")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          categoryId,
          name: "Concurrent Simple Product",
          sku: testSku,
          description: "Desc",
          price: "100.00"
        }),
      request(app)
        .post(`/api/v1/admin/products/${parentId}/variants`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          name: "Concurrent Variant",
          sku: testSku,
          price: "100.00"
        })
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([201, 409]); // Exactly one 201 created, one 409 conflict

    const reservations = await sequelize.query<{ sku: string }>(
      "SELECT `sku` FROM `catalog_sku_reservations` WHERE `sku` = ?",
      {
        replacements: [testSku],
        type: QueryTypes.SELECT
      }
    );

    expect(reservations).toHaveLength(1);
  });
});


