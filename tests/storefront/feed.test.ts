/* eslint-disable */
import { randomUUID } from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { Category, MediaAsset, Product, ProductImage, ProductMediaAssignment, ProductReview, User } from "../../src/database/tables/index.js";
import { objectStorageService } from "../../src/services/object-storage/object-storage.service.js";

let categoryId: number;
let uploaderId: number;

async function nextId(sequenceName: string): Promise<number> {
  return sequelize.transaction((t) => IdSequenceService.allocateNextId(sequenceName, t));
}

async function seedProduct(name: string): Promise<Product> {
  const id = await nextId("products");
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  return Product.create({
    id, category_id: categoryId, name, slug: `feed-${suffix}`, sku: `FEED-${suffix}`,
    description: "Feed product", pet_type: "all", status: "active", price: "500.00",
    compare_at_price: null, stock: 10, has_variants: false, featured: false
  } as never);
}

async function seedVideo(title: string): Promise<MediaAsset> {
  const id = await nextId("media_assets");
  const key = `media/2026/08/27/${randomUUID()}.mp4`;
  return MediaAsset.create({
    id, file_name: `${title}.mp4`, original_name: `${title}.mp4`, storage_key: key,
    public_url: `https://cdn.example.test/${key}`, mime_type: "video/mp4", media_type: "video",
    file_size: 1000, width: 720, height: 1280, alt_text: null, title, uploaded_by: uploaderId
  });
}

describe("Storefront testimonial and review feeds", () => {
  beforeAll(async () => {
    await connectDatabase();
    let uploader = await User.findOne({ where: { role: "admin" }, paranoid: false });
    if (!uploader) {
      const id = await nextId("users");
      uploader = await User.create({
        id,
        reference_code: `FEED-${id}`,
        name: "Feed Test Admin",
        email: `feed-admin-${id}@example.test`,
        password_hash: "test-password-hash",
        role: "admin",
        status: "active",
        phone: null,
        email_verified_at: null,
        last_login_at: null
      });
    }
    uploaderId = uploader.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await ProductReview.destroy({ where: {}, force: true });
    await ProductMediaAssignment.destroy({ where: {}, force: true });
    await ProductImage.destroy({ where: {}, force: true });
    await MediaAsset.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    const category = await Category.create({
      id: await nextId("categories"), name: `Feed Cat ${Date.now()}`, slug: `feed-cat-${randomUUID()}`,
      description: "Feed", pet_type: "all", active: true, display_order: 1
    });
    categoryId = category.id;
  });

  it("returns only active testimonial videos with product context", async () => {
    const product = await seedProduct("Harness");
    const video = await seedVideo("Customer story");
    const inactiveVideo = await seedVideo("Hidden story");
    await ProductMediaAssignment.create({ id: await nextId("product_media_assignments"), product_id: product.id, media_asset_id: video.id, media_role: "testimonial_video", title: "Loved it", caption: "A caption", display_order: 1, active: true });
    await ProductMediaAssignment.create({ id: await nextId("product_media_assignments"), product_id: product.id, media_asset_id: inactiveVideo.id, media_role: "testimonial_video", title: "Hidden", caption: null, display_order: 2, active: false });
    await ProductMediaAssignment.create({ id: await nextId("product_media_assignments"), product_id: product.id, media_asset_id: video.id, media_role: "product_video", title: "How to use", caption: null, display_order: 0, active: true });

    const res = await request(app).get("/api/v1/storefront/testimonials");
    expect(res.status).toBe(200);
    expect(res.body.data.testimonials).toHaveLength(1);
    expect(res.body.data.testimonials[0]).toMatchObject({ id: expect.any(Number), videoUrl: objectStorageService.getPublicUrl(video.storage_key), title: "Loved it", caption: "A caption", product: { id: product.id, name: product.name, slug: product.slug, image: null } });
    expect(res.body.data.testimonials[0]).not.toHaveProperty("product_id");
  });

  it("filters the product testimonial endpoint", async () => {
    const product = await seedProduct("Visible");
    const other = await seedProduct("Other");
    const video = await seedVideo("Story");
    await ProductMediaAssignment.create({ id: await nextId("product_media_assignments"), product_id: product.id, media_asset_id: video.id, media_role: "testimonial_video", title: null, caption: null, display_order: 0, active: true });
    await ProductMediaAssignment.create({ id: await nextId("product_media_assignments"), product_id: other.id, media_asset_id: video.id, media_role: "testimonial_video", title: null, caption: null, display_order: 0, active: true });

    const res = await request(app).get(`/api/v1/storefront/products/${product.id}/testimonials`);
    expect(res.status).toBe(200);
    expect(res.body.data.testimonials).toHaveLength(1);
    expect(res.body.data.testimonials[0].product.id).toBe(product.id);
  });

  it("returns approved reviews only and paginates with product context", async () => {
    const product = await seedProduct("Review product");
    for (const [index, status] of (["approved", "approved", "rejected"] as const).entries()) {
      await ProductReview.create({ id: await nextId("product_reviews"), product_id: product.id, user_id: null, order_item_id: null, rating: index + 3, title: `Title ${index}`, review: `Review ${index}`, status, verified_purchase: false, customer_name: `Customer ${index}`, review_source: "admin" });
    }

    const first = await request(app).get("/api/v1/storefront/reviews?page=1&pageSize=1");
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
    expect(first.body.data.reviews).toHaveLength(1);
    expect(first.body.data.reviews[0]).toMatchObject({ rating: expect.any(Number), customerName: expect.any(String), product: { id: product.id, name: product.name, slug: product.slug, image: null } });

    const second = await request(app).get("/api/v1/storefront/reviews?page=2&pageSize=1");
    expect(second.status).toBe(200);
    expect(second.body.data.reviews).toHaveLength(1);
    expect(second.body.data.reviews[0].review).not.toBe("Review 2");
  });
});
