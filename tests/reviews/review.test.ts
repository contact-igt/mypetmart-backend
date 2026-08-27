/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";
import {
  AuthSession,
  Category,
  Order,
  OrderItem,
  Product,
  ProductContentBlock,
  ProductFaq,
  ProductFeature,
  ProductMediaAssignment,
  ProductReview,
  ProductSpecification,
  ProductVariant,
  User
} from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

type OrderStatus = "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled" | "return_requested";

let counter = 0;
async function nextId(sequenceName: string): Promise<number> {
  return sequelize.transaction((t) => IdSequenceService.allocateNextId(sequenceName, t));
}

async function seedUser(role: "customer" | "admin", name: string): Promise<{ user: User; token: string }> {
  counter += 1;
  const id = await nextId("users");
  const email = `review-test-${role}-${id}@example.com`;
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const user = await User.create({ id, name, email, password_hash: pwdHash, role, status: "active", reference_code: `REV-${id}` });
  const sessionType = role === "customer" ? "customer" : "admin";
  const { session } = await SessionService.createSession(user.id, sessionType, null, null);
  const token = TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role, sessionType });
  return { user, token };
}

async function seedCategory(): Promise<number> {
  const id = await nextId("categories");
  const suffix = `${Date.now()}-${counter}`;
  const category = await Category.create({ id, name: `Review Cat ${suffix}`, slug: `review-cat-${suffix}-${Math.random().toString(36).slice(2, 8)}`, description: "d", pet_type: "all", active: true, display_order: 1 });
  return category.id;
}

async function seedProduct(categoryId: number, overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  counter += 1;
  const id = await nextId("products");
  const suffix = `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 6)}`;
  return Product.create(
    {
      id, category_id: categoryId, name: `Review Product ${suffix}`, slug: `review-product-${suffix}`, sku: `REV-SKU-${suffix}`,
      description: "d", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 50, has_variants: false, featured: false,
      ...overrides
    } as never
  );
}

async function seedOrderItem(userId: number | null, product: Product, status: OrderStatus, variantId: number | null = null): Promise<{ order: Order; item: OrderItem }> {
  const orderId = await nextId("orders");
  const order = await Order.create({
    id: orderId, order_number: buildBusinessReference("order", orderId), user_id: userId,
    guest_identity_hash: null, guest_access_token_hash: null, cart_id: null, contact_email: "review-test@example.com",
    status, payment_status: status === "cancelled" ? "cancelled" : "paid", fulfilment_status: status === "delivered" ? "delivered" : "unfulfilled", commerce_exception: null,
    subtotal: "500.00", shipping_fee: "0.00", total: "500.00", currency: "INR",
    ship_recipient_name: "Review Recipient", ship_phone: "+91 98765 43210", ship_line_1: "1 Test Street", ship_line_2: null,
    ship_city: "Chennai", ship_state: "Tamil Nadu", ship_postal_code: "600001", ship_country: "IN", ship_latitude: null, ship_longitude: null,
    placed_at: new Date(), cancelled_at: status === "cancelled" ? new Date() : null
  });

  const itemId = await nextId("order_items");
  const item = await OrderItem.create({
    id: itemId, order_id: order.id, product_id: product.id, product_variant_id: variantId, product_name: product.name, product_sku: product.sku,
    variant_name: null, variant_sku: null, product_image: null, quantity: 1, unit_price: "500.00", line_total: "500.00"
  });

  return { order, item };
}

const REVIEWS_BASE = "/api/v1/storefront/products";
const ADMIN_REVIEWS_BASE = "/api/v1/admin/product-reviews";

describe("Written Product Reviews — Backend Integration Tests", () => {
  let categoryId: number;

  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await ProductSpecification.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    categoryId = await seedCategory();
  });

  it("1. unauthenticated cannot create a Review", async () => {
    const product = await seedProduct(categoryId);
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).send({ rating: 5, review: "Great product" });
    expect(res.status).toBe(401);
  });

  it("2. authenticated non-purchaser cannot create a Review", async () => {
    const product = await seedProduct(categoryId);
    const { token } = await seedUser("customer", "Never Bought");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Great product" });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("REVIEW_NOT_ELIGIBLE");
  });

  it("3. purchased but not delivered cannot create a Review", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Shipped Buyer");
    await seedOrderItem(user.id, product, "shipped");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Great product" });
    expect(res.status).toBe(403);
  });

  it("4. delivered purchaser can create a Review", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Delivered Buyer");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Great product" });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
  });

  it("5. rating 1 is accepted", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Rater One");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 1, review: "Not great" });
    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(1);
  });

  it("6. rating 5 is accepted", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Rater Five");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Excellent" });
    expect(res.status).toBe(201);
    expect(res.body.data.rating).toBe(5);
  });

  it("7. rating outside 1-5 is rejected", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Bad Rater");
    await seedOrderItem(user.id, product, "delivered");
    const resZero = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 0, review: "x" });
    expect(resZero.status).toBe(400);
    const resSix = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 6, review: "x" });
    expect(resSix.status).toBe(400);
  });

  it("8. review text is required", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "No Text");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5 });
    expect(res.status).toBe(400);
  });

  it("9. whitespace-only review is rejected", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Whitespace");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "     " });
    expect(res.status).toBe(400);
  });

  it("10. title is optional", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "No Title");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 4, review: "Good enough" });
    expect(res.status).toBe(201);
    expect(res.body.data.title).toBeNull();
  });

  it("11. server derives userId — the created Review belongs to the authenticated user only", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Real Owner");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine", userId: 999999 });
    expect(res.status).toBe(201);
    const stored = await ProductReview.findByPk(res.body.data.id);
    expect(stored!.user_id).toBe(user.id);
  });

  it("12. server derives verifiedPurchase — client cannot set it false", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Verified Only");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine", verifiedPurchase: false });
    expect(res.status).toBe(201);
    expect(res.body.data.verifiedPurchase).toBe(true);
  });

  it("13. server derives the qualifying OrderItem — a client-supplied orderItemId is ignored", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Real Item");
    const { item } = await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine", orderItemId: 999999 });
    expect(res.status).toBe(201);
    const stored = await ProductReview.findByPk(res.body.data.id);
    expect(stored!.order_item_id).toBe(item.id);
  });

  it("14. client cannot set approved status on create", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Sneaky Approver");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine", status: "approved" });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe("pending");
  });

  it("15. client cannot set verifiedPurchase true when actually ineligible (covered by eligibility gate)", async () => {
    const product = await seedProduct(categoryId);
    const { token } = await seedUser("customer", "Ineligible Faker");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine", verifiedPurchase: true });
    expect(res.status).toBe(403);
  });

  it("16. duplicate Review for the same Product is rejected", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Repeat Reviewer");
    await seedOrderItem(user.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "First" });
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 4, review: "Second" });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("DUPLICATE_REVIEW");
  });

  it("17. duplicate race is protected by the DB unique constraint", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Race Reviewer");
    await seedOrderItem(user.id, product, "delivered");
    const [a, b] = await Promise.all([
      request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Race A" }),
      request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 4, review: "Race B" })
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    const count = await ProductReview.count({ where: { user_id: user.id, product_id: product.id } });
    expect(count).toBe(1);
  });

  it("18. the same customer may review different Products", async () => {
    const productA = await seedProduct(categoryId);
    const productB = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Multi Reviewer");
    await seedOrderItem(user.id, productA, "delivered");
    await seedOrderItem(user.id, productB, "delivered");
    const resA = await request(app).post(`${REVIEWS_BASE}/${productA.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "A" });
    const resB = await request(app).post(`${REVIEWS_BASE}/${productB.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 4, review: "B" });
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it("19. different customers may review the same Product", async () => {
    const product = await seedProduct(categoryId);
    const { user: userA, token: tokenA } = await seedUser("customer", "Reviewer A");
    const { user: userB, token: tokenB } = await seedUser("customer", "Reviewer B");
    await seedOrderItem(userA.id, product, "delivered");
    await seedOrderItem(userB.id, product, "delivered");
    const resA = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${tokenA}`).send({ rating: 5, review: "A" });
    const resB = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${tokenB}`).send({ rating: 3, review: "B" });
    expect(resA.status).toBe(201);
    expect(resB.status).toBe(201);
  });

  it("20. a new Review defaults to pending", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Default Pending");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    expect(res.body.data.status).toBe("pending");
  });

  it("21. pending Reviews are not publicly listed", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Pending Hidden");
    await seedOrderItem(user.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    expect(list.body.data.items).toHaveLength(0);
  });

  it("22. rejected Reviews are not publicly listed", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Rejected Hidden");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    const created = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "rejected" });
    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    expect(list.body.data.items).toHaveLength(0);
  });

  it("23. approved Reviews are publicly listed", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Approved Shown");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    const created = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });
    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].review).toBe("Mine");
  });

  it("24. public Review DTO never leaks userId/orderItemId/email/status", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Privacy Test");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    const created = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });
    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    const item = list.body.data.items[0];
    expect(item.userId).toBeUndefined();
    expect(item.orderItemId).toBeUndefined();
    expect(item.email).toBeUndefined();
    expect(item.status).toBeUndefined();
  });

  it("25. display-name masking: two-word name shortens the surname to an initial; single-word name is unchanged", async () => {
    const product = await seedProduct(categoryId);
    const { user: userA, token: tokenA } = await seedUser("customer", "Rahul Kumar");
    const { user: userB, token: tokenB } = await seedUser("customer", "Priya");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(userA.id, product, "delivered");
    await seedOrderItem(userB.id, product, "delivered");
    const createdA = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${tokenA}`).send({ rating: 5, review: "A" });
    const createdB = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${tokenB}`).send({ rating: 4, review: "B" });
    await request(app).patch(`${ADMIN_REVIEWS_BASE}/${createdA.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });
    await request(app).patch(`${ADMIN_REVIEWS_BASE}/${createdB.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });

    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    const names = list.body.data.items.map((i: { customerDisplayName: string }) => i.customerDisplayName).sort();
    expect(names).toEqual(["Priya", "Rahul K."]);
  });

  it("26. Admin list returns Reviews", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Admin List Test");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    const list = await request(app).get(ADMIN_REVIEWS_BASE).set("Authorization", `Bearer ${adminToken}`);
    expect(list.status).toBe(200);
    expect(list.body.data.items.length).toBeGreaterThanOrEqual(1);
  });

  it("27. Admin list supports a status filter", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Status Filter Test");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    const list = await request(app).get(`${ADMIN_REVIEWS_BASE}?status=approved`).set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.data.items.every((i: { status: string }) => i.status === "approved")).toBe(true);
  });

  it("28. Admin list supports a rating filter", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Rating Filter Test");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 2, review: "Meh" });
    const list = await request(app).get(`${ADMIN_REVIEWS_BASE}?rating=2`).set("Authorization", `Bearer ${adminToken}`);
    expect(list.body.data.items.every((i: { rating: number }) => i.rating === 2)).toBe(true);
  });

  it("29. Admin can approve a Review", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "To Approve");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    const created = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    const res = await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("approved");
  });

  it("30. Admin can reject a Review", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "To Reject");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    const created = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    const res = await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "rejected" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("rejected");
  });

  it("31. a customer can edit their own Review", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Self Editor");
    await seedOrderItem(user.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 3, review: "Okay" });
    const res = await request(app).patch(`${REVIEWS_BASE}/${product.id}/reviews/me`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Actually great" });
    expect(res.status).toBe(200);
    expect(res.body.data.rating).toBe(5);
    expect(res.body.data.review).toBe("Actually great");
  });

  it("32. a customer without their own Review cannot edit via /me (no cross-customer edit path exists)", async () => {
    const product = await seedProduct(categoryId);
    const { user: userA, token: tokenA } = await seedUser("customer", "Owner");
    const { user: userB, token: tokenB } = await seedUser("customer", "Stranger");
    await seedOrderItem(userA.id, product, "delivered");
    await seedOrderItem(userB.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${tokenA}`).send({ rating: 5, review: "Owner's review" });
    const res = await request(app).patch(`${REVIEWS_BASE}/${product.id}/reviews/me`).set("Authorization", `Bearer ${tokenB}`).send({ rating: 1, review: "Hijack attempt" });
    expect(res.status).toBe(404);
    const stillOwners = await ProductReview.findOne({ where: { product_id: product.id, user_id: userA.id } });
    expect(stillOwners!.review).toBe("Owner's review");
  });

  it("33. editing an approved Review resets it to pending", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Approved Editor");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    const created = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });
    const res = await request(app).patch(`${REVIEWS_BASE}/${product.id}/reviews/me`).set("Authorization", `Bearer ${token}`).send({ review: "Updated after approval" });
    expect(res.body.data.status).toBe("pending");
  });

  it("34. editing a rejected Review resets it to pending", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Rejected Editor");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(user.id, product, "delivered");
    const created = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "rejected" });
    const res = await request(app).patch(`${REVIEWS_BASE}/${product.id}/reviews/me`).set("Authorization", `Bearer ${token}`).send({ review: "Updated after rejection" });
    expect(res.body.data.status).toBe("pending");
  });

  it("35. editing a pending Review keeps it pending", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Pending Editor");
    await seedOrderItem(user.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    const res = await request(app).patch(`${REVIEWS_BASE}/${product.id}/reviews/me`).set("Authorization", `Bearer ${token}`).send({ review: "Updated while pending" });
    expect(res.body.data.status).toBe("pending");
  });

  it("36. average rating counts only approved Reviews", async () => {
    const product = await seedProduct(categoryId);
    const { user: userA, token: tokenA } = await seedUser("customer", "Avg A");
    const { user: userB, token: tokenB } = await seedUser("customer", "Avg B");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(userA.id, product, "delivered");
    await seedOrderItem(userB.id, product, "delivered");
    const a = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${tokenA}`).send({ rating: 5, review: "A" });
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${tokenB}`).send({ rating: 1, review: "B" });
    await request(app).patch(`${ADMIN_REVIEWS_BASE}/${a.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });

    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    expect(list.body.data.summary.averageRating).toBe(5);
    expect(list.body.data.summary.reviewCount).toBe(1);
  });

  it("37. review count reflects only approved Reviews", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Count Test");
    await seedOrderItem(user.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    expect(list.body.data.summary.reviewCount).toBe(0);
  });

  it("38. distribution buckets are correct", async () => {
    const product = await seedProduct(categoryId);
    const { token: adminToken } = await seedUser("admin", "Moderator");
    const ratings = [5, 5, 4, 3, 1];
    for (const rating of ratings) {
      const { user, token } = await seedUser("customer", `Dist ${rating}-${Math.random()}`);
      await seedOrderItem(user.id, product, "delivered");
      const created = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating, review: `Rated ${rating}` });
      await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });
    }
    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    expect(list.body.data.summary.distribution).toEqual({ 5: 2, 4: 1, 3: 1, 2: 0, 1: 1 });
    expect(list.body.data.summary.reviewCount).toBe(5);
    expect(list.body.data.summary.averageRating).toBeCloseTo((5 + 5 + 4 + 3 + 1) / 5, 1);
  });

  it("39. zero-review Product returns an empty, non-fabricated summary", async () => {
    const product = await seedProduct(categoryId);
    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    expect(list.body.data.summary).toEqual({ averageRating: 0, reviewCount: 0, distribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 } });
    expect(list.body.data.items).toEqual([]);
  });

  it("40. a returned/refunded delivered purchase remains review-eligible", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Returned Buyer");
    await seedOrderItem(user.id, product, "return_requested");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 4, review: "Still had it long enough to use it" });
    expect(res.status).toBe(201);
  });

  it("41. a cancelled/non-delivered purchase is not review-eligible", async () => {
    const product = await seedProduct(categoryId);
    const { user, token } = await seedUser("customer", "Cancelled Buyer");
    await seedOrderItem(user.id, product, "cancelled");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 4, review: "Never got it" });
    expect(res.status).toBe(403);
  });

  it("42. a Simple Product purchase qualifies for a Review", async () => {
    const product = await seedProduct(categoryId, { has_variants: false });
    const { user, token } = await seedUser("customer", "Simple Buyer");
    await seedOrderItem(user.id, product, "delivered");
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Simple product review" });
    expect(res.status).toBe(201);
  });

  it("43. a Variant Product purchase qualifies for a Product-level Review", async () => {
    const product = await seedProduct(categoryId, { has_variants: true, price: "0.00" });
    const variantId = await nextId("product_variants");
    await ProductVariant.create({
      id: variantId, product_id: product.id, name: "Medium", sku: `REV-VAR-${variantId}`, price: "600.00", compare_at_price: null,
      stock: 10, active: true, display_order: 0, weight_grams: null, length_cm: null, width_cm: null, height_cm: null
    });
    const { user, token } = await seedUser("customer", "Variant Buyer");
    await seedOrderItem(user.id, product, "delivered", variantId);
    const res = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Variant purchase review" });
    expect(res.status).toBe(201);
  });

  it("44. Storefront and Admin Product list responses remain free of review arrays", async () => {
    const product = await seedProduct(categoryId);
    const list = await request(app).get("/api/v1/storefront/products");
    const item = list.body.data.items.find((entry: { id: number }) => entry.id === product.id);
    if (item) expect(item.reviews).toBeUndefined();

    const { token: adminToken } = await seedUser("admin", "List Checker");
    const adminList = await request(app).get("/api/v1/admin/products").set("Authorization", `Bearer ${adminToken}`);
    expect(adminList.body.data.items.every((entry: { reviews?: unknown }) => entry.reviews === undefined)).toBe(true);
  });

  it("45. review-eligibility endpoint returns a safe unauthenticated state, and a real eligible/hasReview state once authenticated", async () => {
    const product = await seedProduct(categoryId);
    const anon = await request(app).get(`${REVIEWS_BASE}/${product.id}/review-eligibility`);
    expect(anon.status).toBe(200);
    expect(anon.body.data).toEqual({ authenticated: false, eligible: false, hasReview: false });

    const { user, token } = await seedUser("customer", "Eligibility Checker");
    const beforePurchase = await request(app).get(`${REVIEWS_BASE}/${product.id}/review-eligibility`).set("Authorization", `Bearer ${token}`);
    expect(beforePurchase.body.data).toEqual({ authenticated: true, eligible: false, hasReview: false });

    await seedOrderItem(user.id, product, "delivered");
    const afterPurchase = await request(app).get(`${REVIEWS_BASE}/${product.id}/review-eligibility`).set("Authorization", `Bearer ${token}`);
    expect(afterPurchase.body.data).toEqual({ authenticated: true, eligible: true, hasReview: false });

    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${token}`).send({ rating: 5, review: "Mine" });
    const afterReview = await request(app).get(`${REVIEWS_BASE}/${product.id}/review-eligibility`).set("Authorization", `Bearer ${token}`);
    expect(afterReview.body.data.hasReview).toBe(true);
    expect(afterReview.body.data.reviewStatus).toBe("pending");
    expect(afterReview.body.data.review.rating).toBe(5);
  });

  it("Admin Review Management: 1. Admin can create a manual Review — server forces reviewSource=admin, verifiedPurchase=false, userId=null, orderItemId=null", async () => {
    const product = await seedProduct(categoryId);
    const { token: adminToken } = await seedUser("admin", "Moderator");

    const res = await request(app)
      .post(ADMIN_REVIEWS_BASE)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: product.id, customerName: "Priya S.", rating: 4, title: "Nice", review: "Good product overall.", status: "approved" });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      productId: product.id,
      customerName: "Priya S.",
      rating: 4,
      title: "Nice",
      review: "Good product overall.",
      status: "approved",
      verifiedPurchase: false,
      reviewSource: "admin",
      userId: null,
      orderItemId: null
    });
  });

  it("2. Admin-create ignores client-supplied userId/verifiedPurchase/orderItemId/reviewSource", async () => {
    const product = await seedProduct(categoryId);
    const { user: victim } = await seedUser("customer", "Victim");
    const { token: adminToken } = await seedUser("admin", "Moderator");

    const res = await request(app)
      .post(ADMIN_REVIEWS_BASE)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: product.id, rating: 5, review: "Attempted spoof.", userId: victim.id, verifiedPurchase: true, orderItemId: 99999, reviewSource: "customer" });

    expect(res.status).toBe(201);
    expect(res.body.data.userId).toBeNull();
    expect(res.body.data.orderItemId).toBeNull();
    expect(res.body.data.verifiedPurchase).toBe(false);
    expect(res.body.data.reviewSource).toBe("admin");
  });

  it("3. Admin can edit a Review's rating/title/review", async () => {
    const product = await seedProduct(categoryId);
    const { token: adminToken } = await seedUser("admin", "Moderator");
    const created = await request(app).post(ADMIN_REVIEWS_BASE).set("Authorization", `Bearer ${adminToken}`).send({ productId: product.id, rating: 3, review: "Original text." });

    const res = await request(app)
      .patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ rating: 5, title: "Updated", review: "Edited text." });

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rating: 5, title: "Updated", review: "Edited text." });
  });

  it("4. Admin can approve and reject a Review via the existing status endpoint", async () => {
    const product = await seedProduct(categoryId);
    const { token: adminToken } = await seedUser("admin", "Moderator");
    const created = await request(app).post(ADMIN_REVIEWS_BASE).set("Authorization", `Bearer ${adminToken}`).send({ productId: product.id, rating: 4, review: "Pending review." });

    const approved = await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });
    expect(approved.body.data.status).toBe("approved");

    const rejected = await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "rejected" });
    expect(rejected.body.data.status).toBe("rejected");
  });

  it("5. Admin can delete a Review", async () => {
    const product = await seedProduct(categoryId);
    const { token: adminToken } = await seedUser("admin", "Moderator");
    const created = await request(app).post(ADMIN_REVIEWS_BASE).set("Authorization", `Bearer ${adminToken}`).send({ productId: product.id, rating: 4, review: "To be deleted." });

    const del = await request(app).delete(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(del.status).toBe(200);

    const get = await request(app).get(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`);
    expect(get.status).toBe(404);
  });

  it("6. A Customer (non-admin token) cannot create an Admin Review", async () => {
    const product = await seedProduct(categoryId);
    const { token: customerToken } = await seedUser("customer", "Not An Admin");

    const res = await request(app)
      .post(ADMIN_REVIEWS_BASE)
      .set("Authorization", `Bearer ${customerToken}`)
      .send({ productId: product.id, rating: 5, review: "Should be rejected." });

    expect(res.status).toBe(401);
  });

  it("7. An unauthenticated request cannot create an Admin Review", async () => {
    const product = await seedProduct(categoryId);
    const res = await request(app).post(ADMIN_REVIEWS_BASE).send({ productId: product.id, rating: 5, review: "No token." });
    expect(res.status).toBe(401);
  });

  it("8. Admin Review list can filter by source", async () => {
    const product = await seedProduct(categoryId);
    const { user: customer, token: customerToken } = await seedUser("customer", "Real Buyer");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(customer.id, product, "delivered");
    await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${customerToken}`).send({ rating: 5, review: "Genuine customer review." });
    await request(app).post(ADMIN_REVIEWS_BASE).set("Authorization", `Bearer ${adminToken}`).send({ productId: product.id, rating: 4, review: "Manual admin review." });

    const adminOnly = await request(app).get(`${ADMIN_REVIEWS_BASE}?source=admin`).set("Authorization", `Bearer ${adminToken}`);
    expect(adminOnly.body.data.items).toHaveLength(1);
    expect(adminOnly.body.data.items[0].reviewSource).toBe("admin");

    const customerOnly = await request(app).get(`${ADMIN_REVIEWS_BASE}?source=customer`).set("Authorization", `Bearer ${adminToken}`);
    expect(customerOnly.body.data.items).toHaveLength(1);
    expect(customerOnly.body.data.items[0].reviewSource).toBe("customer");
  });

  it("9. Admin-created Review never shows a Verified Purchase badge on the Storefront public list", async () => {
    const product = await seedProduct(categoryId);
    const { token: adminToken } = await seedUser("admin", "Moderator");
    const created = await request(app)
      .post(ADMIN_REVIEWS_BASE)
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ productId: product.id, customerName: "Manual Reviewer", rating: 5, review: "Looks great.", status: "approved" });
    expect(created.status).toBe(201);
    // Defensive display contract: even a malformed historical admin row must
    // not be surfaced as a verified customer purchase.
    await ProductReview.update({ verified_purchase: true }, { where: { id: created.body.data.id } });

    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].verifiedPurchase).toBe(false);
    expect(list.body.data.items[0].reviewSource).toBe("admin");
    expect(list.body.data.items[0].customerName).toBe("Manual Reviewer");
    expect(list.body.data.items[0].customerDisplayName).toBe("Manual Reviewer");
  });

  it("10. A genuine Customer Review still shows Verified Purchase on the Storefront public list", async () => {
    const product = await seedProduct(categoryId);
    const { user: customer, token: customerToken } = await seedUser("customer", "Genuine Buyer");
    const { token: adminToken } = await seedUser("admin", "Moderator");
    await seedOrderItem(customer.id, product, "delivered");
    const created = await request(app).post(`${REVIEWS_BASE}/${product.id}/reviews`).set("Authorization", `Bearer ${customerToken}`).send({ rating: 5, review: "Really happy with it." });
    await request(app).patch(`${ADMIN_REVIEWS_BASE}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`).send({ status: "approved" });

    const list = await request(app).get(`${REVIEWS_BASE}/${product.id}/reviews`);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.items[0].verifiedPurchase).toBe(true);
    expect(list.body.data.items[0].reviewSource).toBe("customer");
    expect(list.body.data.items[0].customerName).toBe("Genuine B.");
  });

  it("11. Admin-create rejects a nonexistent productId", async () => {
    const { token: adminToken } = await seedUser("admin", "Moderator");
    const res = await request(app).post(ADMIN_REVIEWS_BASE).set("Authorization", `Bearer ${adminToken}`).send({ productId: 999999999, rating: 5, review: "Ghost product." });
    expect(res.status).toBe(404);
  });

  it("12. Admin-create rejects an empty review body", async () => {
    const product = await seedProduct(categoryId);
    const { token: adminToken } = await seedUser("admin", "Moderator");
    const res = await request(app).post(ADMIN_REVIEWS_BASE).set("Authorization", `Bearer ${adminToken}`).send({ productId: product.id, rating: 5, review: "   " });
    expect(res.status).toBe(400);
  });
});
