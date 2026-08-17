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
import { Wishlist } from "../../src/database/tables/WishlistTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

const WISHLIST_URL = "/api/v1/storefront/wishlist";

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      {
        id,
        name: "Wishlist Test Category",
        slug: `wishlist-test-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: "Category for Wishlist backend tests",
        pet_type: "all",
        active: true,
        display_order: 1
      },
      { transaction: t }
    );
  });
  return category.id;
}

async function createProduct(overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id,
        category_id: categoryId,
        name: `Wishlist Test Product ${skuCounter}`,
        slug: `wishlist-test-product-${skuCounter}-${Date.now()}`,
        sku: `WISHLIST-${skuCounter}-${Date.now()}`,
        description: "Product for Wishlist tests",
        pet_type: "all",
        status: "active",
        price: "499.00",
        compare_at_price: null,
        stock: 50,
        has_variants: false,
        featured: false,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

async function mintCustomerToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const user = await User.create({
    id,
    name: `Wishlist Test Customer ${id}`,
    email,
    password_hash: pwdHash,
    role: "customer",
    status: "active",
    reference_code: `CUS-WL-${id}`
  });
  const { session } = await SessionService.createSession(user.id, "customer", null, null);
  return TokenService.generateAccessToken({
    sub: String(user.id),
    sessionId: String(session.id),
    role: "customer",
    sessionType: "customer"
  });
}

describe("Wishlist Backend Integration Tests", () => {
  let customerAToken: string;
  let customerBToken: string;

  beforeAll(async () => {
    await connectDatabase();

    for (const id of [99401, 99402]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }

    customerAToken = await mintCustomerToken(99401, "wishlist-test-customer-a@example.com");
    customerBToken = await mintCustomerToken(99402, "wishlist-test-customer-b@example.com");
  });

  afterAll(async () => {
    // Mirrors cart.test.ts's cleanup order: other test files' beforeEach hard-deletes
    // Products without touching wishlists, and vitest --pool=threads runs test files
    // concurrently, so variants/images must be cleared before Products to avoid tripping
    // their FK (RESTRICT) regardless of suite ordering.
    await Wishlist.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: [99401, 99402] }, force: true });
    await User.destroy({ where: { id: [99401, 99402] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Wishlist.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    categoryId = await createCategory();
  });

  // ---------------------------------------------------------------------
  // Authentication
  // ---------------------------------------------------------------------
  describe("Authentication", () => {
    it("rejects an unauthenticated GET", async () => {
      const res = await request(app).get(WISHLIST_URL);
      expect(res.status).toBe(401);
    });

    it("rejects an unauthenticated add", async () => {
      const product = await createProduct();
      const res = await request(app).post(`${WISHLIST_URL}/items`).send({ productId: product.id });
      expect(res.status).toBe(401);
    });

    it("rejects an unauthenticated remove", async () => {
      const res = await request(app).delete(`${WISHLIST_URL}/items/1`);
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------
  // Basic CRUD
  // ---------------------------------------------------------------------
  describe("Authenticated Customer Wishlist", () => {
    it("returns an empty wishlist when none exists yet", async () => {
      const res = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ items: [] });
      expect(res.body.success).toBe(true);
      expect(res.body.meta.requestId).toBeDefined();
    });

    it("adds a product to the wishlist and returns 201", async () => {
      const product = await createProduct();
      const res = await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });

      expect(res.status).toBe(201);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({
        product: {
          id: product.id,
          name: product.name,
          slug: product.slug,
          hasVariants: false,
          inStock: true,
          available: true
        }
      });
      expect(res.body.data.items[0].wishlistItemId).toBeDefined();
      expect(res.body.data.items[0].createdAt).toBeDefined();
    });

    it("is idempotent when adding the same product twice, returning 200 the second time", async () => {
      const product = await createProduct();
      const first = await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });
      expect(first.status).toBe(201);

      const second = await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });
      expect(second.status).toBe(200);
      expect(second.body.data.items).toHaveLength(1);

      const rows = await Wishlist.findAll({ where: { user_id: 99401, product_id: product.id } });
      expect(rows).toHaveLength(1);
    });

    it("removes a product from the wishlist", async () => {
      const product = await createProduct();
      await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });

      const res = await request(app).delete(`${WISHLIST_URL}/items/${product.id}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });

    it("returns 404 when removing a product that is not in the wishlist", async () => {
      const product = await createProduct();
      const res = await request(app).delete(`${WISHLIST_URL}/items/${product.id}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("WISHLIST_ITEM_NOT_FOUND");
    });

    it("orders items most-recently-wishlisted first", async () => {
      const first = await createProduct();
      const second = await createProduct();
      await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: first.id });
      await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: second.id });

      const res = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items.map((i: { product: { id: number } }) => i.product.id)).toEqual([second.id, first.id]);
    });
  });

  // ---------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------
  describe("Validation", () => {
    it("rejects a non-integer productId on add", async () => {
      const res = await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: "abc" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUTH_VALIDATION_FAILED");
    });

    it("rejects a missing productId on add", async () => {
      const res = await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUTH_VALIDATION_FAILED");
    });

    it("returns 404 for a nonexistent product id on add", async () => {
      const res = await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: 999999999 });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
    });

    it("rejects a non-numeric productId path param on remove", async () => {
      const res = await request(app).delete(`${WISHLIST_URL}/items/not-a-number`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("INVALID_WISHLIST_PRODUCT_ID");
    });
  });

  // ---------------------------------------------------------------------
  // Ownership isolation
  // ---------------------------------------------------------------------
  describe("Ownership Isolation", () => {
    it("does not show customer A's wishlist to customer B", async () => {
      const product = await createProduct();
      await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });

      const res = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerBToken}`);
      expect(res.body.data.items).toHaveLength(0);
    });

    it("does not allow customer B to remove customer A's wishlist item", async () => {
      const product = await createProduct();
      await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });

      const res = await request(app).delete(`${WISHLIST_URL}/items/${product.id}`).set("Authorization", `Bearer ${customerBToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("WISHLIST_ITEM_NOT_FOUND");

      const stillThere = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(stillThere.body.data.items).toHaveLength(1);
    });

    it("never derives ownership from a client-supplied user id", async () => {
      const product = await createProduct();
      const res = await request(app)
        .post(`${WISHLIST_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, userId: 99402 });

      expect(res.status).toBe(201);
      const aWishlist = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(aWishlist.body.data.items).toHaveLength(1);
      const bWishlist = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerBToken}`);
      expect(bWishlist.body.data.items).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // Concurrency
  // ---------------------------------------------------------------------
  describe("Concurrency", () => {
    it("does not create duplicate rows under concurrent duplicate adds", async () => {
      const product = await createProduct();

      const [resA, resB] = await Promise.all([
        request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id }),
        request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id })
      ]);

      expect([resA.status, resB.status].sort()).toEqual([200, 201]);

      const rows = await Wishlist.findAll({ where: { user_id: 99401, product_id: product.id } });
      expect(rows).toHaveLength(1);

      const finalWishlist = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(finalWishlist.body.data.items).toHaveLength(1);
    });
  });

  // ---------------------------------------------------------------------
  // Product availability / lifecycle
  // ---------------------------------------------------------------------
  describe("Product Availability and Lifecycle", () => {
    it("reports an out-of-stock active product as visible but unavailable", async () => {
      const product = await createProduct({ stock: 0 });
      await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });

      const res = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].product).toMatchObject({ inStock: false, available: false });
    });

    it("reports a draft product as visible but unavailable", async () => {
      const product = await createProduct({ stock: 10 });
      await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });

      product.status = "draft";
      await product.save();

      const res = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].product).toMatchObject({ available: false });
    });

    it("reports an archived product as visible but unavailable", async () => {
      const product = await createProduct({ stock: 10 });
      await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });

      product.status = "archived";
      await product.save();

      const res = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].product).toMatchObject({ available: false });
    });

    it("keeps the wishlist row and reports the product as unavailable after a soft-delete, without deleting the row", async () => {
      const product = await createProduct({ stock: 10 });
      const addRes = await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });
      const wishlistItemId = addRes.body.data.items[0].wishlistItemId;

      await product.destroy();

      const res = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].wishlistItemId).toBe(wishlistItemId);
      expect(res.body.data.items[0].product).toMatchObject({ available: false });

      const row = await Wishlist.findByPk(wishlistItemId);
      expect(row).not.toBeNull();
    });

    it("automatically shows the product as available again once restored and republished", async () => {
      const product = await createProduct({ stock: 10 });
      await request(app).post(`${WISHLIST_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id });

      await product.destroy();
      await product.restore();
      product.status = "active";
      await product.save();

      const res = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].product).toMatchObject({ available: true });
    });
  });

  // ---------------------------------------------------------------------
  // Response envelope
  // ---------------------------------------------------------------------
  describe("Response Envelope", () => {
    it("wraps success responses in the standard envelope", async () => {
      const res = await request(app).get(WISHLIST_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body).toMatchObject({ success: true, data: { items: [] }, meta: { requestId: expect.any(String) } });
    });

    it("wraps error responses in the standard envelope", async () => {
      const res = await request(app).delete(`${WISHLIST_URL}/items/1`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body).toMatchObject({
        success: false,
        error: { code: "WISHLIST_ITEM_NOT_FOUND", message: expect.any(String) },
        meta: { requestId: expect.any(String) }
      });
    });
  });
});
