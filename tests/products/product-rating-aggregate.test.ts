/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { Category, Product, ProductReview } from "../../src/database/tables/index.js";

let counter = 0;
async function nextId(sequenceName: string): Promise<number> {
  return sequelize.transaction((t) => IdSequenceService.allocateNextId(sequenceName, t));
}

async function seedCategory(): Promise<number> {
  const id = await nextId("categories");
  const suffix = `${Date.now()}-${counter}`;
  const category = await Category.create({
    id,
    name: `Rating Cat ${suffix}`,
    slug: `rating-cat-${suffix}-${Math.random().toString(36).slice(2, 8)}`,
    description: "d",
    pet_type: "all",
    active: true,
    display_order: 1
  });
  return category.id;
}

async function seedProduct(categoryId: number, overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  counter += 1;
  const id = await nextId("products");
  const suffix = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
  return Product.create(
    {
      id,
      category_id: categoryId,
      name: `Rating Product ${suffix}`,
      slug: `rating-product-${suffix}`,
      sku: `RATING-SKU-${suffix}`,
      description: "d",
      pet_type: "all",
      status: "active",
      price: "500.00",
      compare_at_price: null,
      stock: 50,
      has_variants: false,
      featured: false,
      ...overrides
    } as never
  );
}

// Reviews are seeded directly against the model (order_item_id/user_id are
// nullable) — this suite is exercising ProductService's aggregation, not the
// eligibility/submission flow already covered by reviews/review.test.ts.
async function seedReview(productId: number, rating: number, status: "pending" | "approved" | "rejected", overrides: Partial<Record<string, unknown>> = {}) {
  const id = await nextId("product_reviews");
  return ProductReview.create({
    id,
    product_id: productId,
    user_id: null,
    order_item_id: null,
    rating,
    title: null,
    review: "Aggregate fixture review",
    status,
    verified_purchase: true,
    customer_name: "Test Reviewer",
    review_source: "customer",
    review_date: null,
    ...overrides
  } as never);
}

const STOREFRONT_PRODUCTS_BASE = "/api/v1/storefront/products";

describe("Product List Rating Aggregates — Backend Integration Tests", () => {
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    categoryId = await seedCategory();
  });

  it("1. two approved ratings (5, 4) aggregate to averageRating 4.5, reviewCount 2", async () => {
    const product = await seedProduct(categoryId);
    await seedReview(product.id, 5, "approved");
    await seedReview(product.id, 4, "approved");

    const res = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?pageSize=50`);
    expect(res.status).toBe(200);
    const item = res.body.data.items.find((p: { id: number }) => p.id === product.id);
    expect(item.averageRating).toBe(4.5);
    expect(item.reviewCount).toBe(2);
  });

  it("2. a product with no reviews reports averageRating 0, reviewCount 0 (never a fabricated default)", async () => {
    const product = await seedProduct(categoryId);

    const res = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?pageSize=50`);
    expect(res.status).toBe(200);
    const item = res.body.data.items.find((p: { id: number }) => p.id === product.id);
    expect(item.averageRating).toBe(0);
    expect(item.reviewCount).toBe(0);
  });

  it("3. a pending review is excluded from the aggregate", async () => {
    const product = await seedProduct(categoryId);
    await seedReview(product.id, 5, "approved");
    await seedReview(product.id, 1, "pending"); // would drag the average down to 3 if counted

    const res = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?pageSize=50`);
    const item = res.body.data.items.find((p: { id: number }) => p.id === product.id);
    expect(item.averageRating).toBe(5);
    expect(item.reviewCount).toBe(1);
  });

  it("4. a rejected review is excluded from the aggregate", async () => {
    const product = await seedProduct(categoryId);
    await seedReview(product.id, 5, "approved");
    await seedReview(product.id, 1, "rejected"); // would drag the average down to 3 if counted

    const res = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?pageSize=50`);
    const item = res.body.data.items.find((p: { id: number }) => p.id === product.id);
    expect(item.averageRating).toBe(5);
    expect(item.reviewCount).toBe(1);
  });

  it("5. an approved review is included in the aggregate", async () => {
    const product = await seedProduct(categoryId);
    await seedReview(product.id, 3, "approved");

    const res = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?pageSize=50`);
    const item = res.body.data.items.find((p: { id: number }) => p.id === product.id);
    expect(item.averageRating).toBe(3);
    expect(item.reviewCount).toBe(1);
  });

  it("6. multiple products aggregate independently with no cross-product mixing", async () => {
    const productA = await seedProduct(categoryId);
    const productB = await seedProduct(categoryId);
    await seedReview(productA.id, 5, "approved");
    await seedReview(productA.id, 5, "approved");
    await seedReview(productB.id, 1, "approved");

    const res = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?pageSize=50`);
    const itemA = res.body.data.items.find((p: { id: number }) => p.id === productA.id);
    const itemB = res.body.data.items.find((p: { id: number }) => p.id === productB.id);
    expect(itemA.averageRating).toBe(5);
    expect(itemA.reviewCount).toBe(2);
    expect(itemB.averageRating).toBe(1);
    expect(itemB.reviewCount).toBe(1);
  });

  it("7. the storefront product list response includes averageRating and reviewCount on every item", async () => {
    await seedProduct(categoryId);
    await seedProduct(categoryId);

    const res = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?pageSize=50`);
    expect(res.status).toBe(200);
    expect(res.body.data.items.length).toBeGreaterThan(0);
    for (const item of res.body.data.items) {
      expect(typeof item.averageRating).toBe("number");
      expect(typeof item.reviewCount).toBe("number");
      expect(Number.isFinite(item.averageRating)).toBe(true);
      expect(Number.isFinite(item.reviewCount)).toBe(true);
    }
  });

  it("8. an empty product result does not fail aggregation", async () => {
    const res = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?category=${encodeURIComponent("no-such-category-slug")}`);
    expect(res.status).toBe(200);
    expect(res.body.data.items).toEqual([]);
  });

  it("9. the list aggregate matches the public per-product Review summary exactly", async () => {
    const product = await seedProduct(categoryId);
    await seedReview(product.id, 5, "approved");
    await seedReview(product.id, 4, "approved");
    await seedReview(product.id, 3, "approved");

    const listRes = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?pageSize=50`);
    const item = listRes.body.data.items.find((p: { id: number }) => p.id === product.id);

    const reviewsRes = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}/${product.id}/reviews`);
    expect(reviewsRes.status).toBe(200);

    expect(item.averageRating).toBe(reviewsRes.body.data.summary.averageRating);
    expect(item.reviewCount).toBe(reviewsRes.body.data.summary.reviewCount);
  });

  it("10. verifiedPurchase does not change rating weighting — every approved review counts equally", async () => {
    const product = await seedProduct(categoryId);
    await seedReview(product.id, 5, "approved", { verified_purchase: true });
    await seedReview(product.id, 1, "approved", { verified_purchase: false });

    const res = await request(app).get(`${STOREFRONT_PRODUCTS_BASE}?pageSize=50`);
    const item = res.body.data.items.find((p: { id: number }) => p.id === product.id);
    expect(item.averageRating).toBe(3); // plain (5+1)/2, not weighted toward the verified review
    expect(item.reviewCount).toBe(2);
  });
});
