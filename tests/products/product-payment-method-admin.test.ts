/* eslint-disable */
// Admin Product create/edit/detail/list for payment-method availability (migration 083).
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductFaq } from "../../src/database/tables/ProductFaqTable/index.js";
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

const URL = "/api/v1/admin/products";

describe("Admin Product payment-method availability", () => {
  let adminToken: string;
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();
    const email = "pm-admin@example.com";
    const existing = await User.findOne({ where: { email }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const admin = await User.create({ id: 99461, name: "PM Admin", email, password_hash: await PasswordService.hash("TestPass123!@#"), role: "admin", status: "active", reference_code: "ADM-099461" });
    const { session } = await SessionService.createSession(admin.id, "admin", null, null);
    adminToken = TokenService.generateAccessToken({ sub: String(admin.id), sessionId: String(session.id), role: "admin", sessionType: "admin" });
  });

  afterAll(async () => { await disconnectDatabase(); });

  beforeEach(async () => {
    await ProductImage.destroy({ where: {}, force: true });
    await ProductVariant.destroy({ where: {}, force: true });
    await ProductFeature.destroy({ where: {}, force: true });
    await ProductMediaAssignment.destroy({ where: {}, force: true });
    await ProductFaq.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");
    categoryId = await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId("categories", t);
      return (await Category.create({ id, name: "PM Food", slug: "pm-food", description: "d", pet_type: "dog", active: true, display_order: 1 }, { transaction: t })).id;
    });
  });

  const create = (sku: string, extra: Record<string, unknown> = {}) =>
    request(app).post(URL).set("Authorization", `Bearer ${adminToken}`).send({ categoryId, name: `PM ${sku}`, sku, description: "d", price: "499.00", stock: 5, ...extra });

  it("defaults to both when the field is omitted (existing admin clients)", async () => {
    const res = await create("PM-DEFAULT");
    expect(res.status).toBe(201);
    expect(res.body.data.paymentMethodEligibility).toBe("both");
  });

  it.each(["both", "payu", "cod"] as const)("creates a %s product and returns it on detail and list", async (value) => {
    const res = await create(`PM-${value.toUpperCase()}`, { paymentMethodEligibility: value });
    expect(res.status).toBe(201);
    expect(res.body.data.paymentMethodEligibility).toBe(value);
    const detail = await request(app).get(`${URL}/${res.body.data.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.paymentMethodEligibility).toBe(value);
    const list = await request(app).get(URL).set("Authorization", `Bearer ${adminToken}`);
    const row = (list.body.data.items ?? list.body.data).find((item: { id: number }) => item.id === res.body.data.id);
    expect(row.paymentMethodEligibility).toBe(value);
  });

  it("edits the value and it persists on reload", async () => {
    const created = await create("PM-EDIT");
    const patched = await request(app).patch(`${URL}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ paymentMethodEligibility: "cod" });
    expect(patched.status).toBe(200);
    const detail = await request(app).get(`${URL}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(detail.body.data.paymentMethodEligibility).toBe("cod");
    // An unrelated edit leaves it untouched.
    await request(app).patch(`${URL}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ name: "PM Renamed" });
    expect((await Product.findByPk(created.body.data.id))!.payment_method_eligibility).toBe("cod");
  });

  it("rejects unknown values on create and update", async () => {
    expect((await create("PM-BAD", { paymentMethodEligibility: "upi" })).status).toBe(400);
    const created = await create("PM-BAD2");
    const res = await request(app).patch(`${URL}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ paymentMethodEligibility: "card" });
    expect(res.status).toBe(400);
  });
});
