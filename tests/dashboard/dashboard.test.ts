/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Order } from "../../src/database/tables/OrderTable/index.js";
import { OrderItem } from "../../src/database/tables/OrderItemTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductFaq } from "../../src/database/tables/ProductFaqTable/index.js";
import { ProductReview } from "../../src/database/tables/ProductReviewTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { ReturnRequest } from "../../src/database/tables/ReturnRequestTable/index.js";
import { Shipment } from "../../src/database/tables/ShipmentTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";

describe("Admin Dashboard (real-data)", () => {
  let adminToken: string;
  let categoryId: number;
  let productId: number;
  let customerId: number;

  async function seedUser(id: number, role: "admin" | "customer", email: string): Promise<{ id: number; token: string }> {
    const existing = await User.findOne({ where: { email }, paranoid: false });
    if (existing) {
      await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
      await User.destroy({ where: { id: existing.id }, force: true });
    }
    const user = await User.create({
      id,
      name: role === "admin" ? "Dashboard Admin" : "Dana Customer",
      email,
      password_hash: await PasswordService.hash("TestPass123!@#"),
      role,
      status: "active",
      reference_code: `DASH-${id}`
    });
    const sessionType = role === "customer" ? "customer" : "admin";
    const { session } = await SessionService.createSession(user.id, sessionType, null, null);
    const token = TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role, sessionType });
    return { id: user.id, token };
  }

  async function createOrder(opts: {
    id: number;
    userId: number | null;
    total: string;
    status: "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled" | "return_requested";
    paymentStatus: "pending" | "paid" | "failed" | "refunded" | "cancelled" | "partially_refunded";
    placedAt: Date;
    state?: string;
    city?: string;
  }): Promise<Order> {
    return sequelize.transaction(async (t) => {
      return Order.create(
        {
          id: opts.id,
          order_number: buildBusinessReference("order", opts.id),
          user_id: opts.userId,
          status: opts.status,
          payment_status: opts.paymentStatus,
          fulfilment_status: "unfulfilled",
          subtotal: opts.total,
          shipping_fee: "0.00",
          total: opts.total,
          ship_recipient_name: "Test Recipient",
          ship_phone: "9000000000",
          ship_line_1: "1 Test Street",
          ship_city: opts.city ?? "Chennai",
          ship_state: opts.state ?? "Tamil Nadu",
          ship_postal_code: "600001",
          placed_at: opts.placedAt
        },
        { transaction: t }
      );
    });
  }

  beforeAll(async () => {
    await connectDatabase();
    const admin = await seedUser(99470, "admin", "dashboard-test-admin@example.com");
    adminToken = admin.token;
    const customer = await seedUser(99471, "customer", "dashboard-test-customer@example.com");
    customerId = customer.id;
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await ReturnRequest.destroy({ where: {}, truncate: false, force: true });
    await Shipment.destroy({ where: {}, truncate: false, force: true });
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await sequelize.query("DELETE FROM `catalog_sku_reservations`");

    const category = await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId("categories", t);
      return Category.create(
        { id, name: "Dog Food", slug: "dog-food-dash", description: "Dog food", pet_type: "dog", active: true, display_order: 1 },
        { transaction: t }
      );
    });
    categoryId = category.id;

    const productRes = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Dashboard Test Kibble", sku: "DASHKIBBLE-001", description: "Kibble" });
    productId = productRes.body.data.id;
  });

  it("blocks an unauthenticated request", async () => {
    const res = await request(app).get("/api/v1/admin/dashboard/summary?from=2026-01-01&to=2026-01-31");
    expect(res.status).toBe(401);
  });

  it("reports isEmpty with no Orders in range", async () => {
    const res = await request(app)
      .get("/api/v1/admin/dashboard/summary?from=2026-01-01&to=2026-01-31")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.isEmpty).toBe(true);
    expect(res.body.data.summary.grossSales.value).toBe(0);
  });

  it("computes gross sales, orders, AOV and customers from real paid Orders only", async () => {
    const placedAt = new Date("2026-06-10T10:00:00Z");
    await createOrder({ id: 501, userId: customerId, total: "500.00", status: "confirmed", paymentStatus: "paid", placedAt });
    await createOrder({ id: 502, userId: customerId, total: "300.00", status: "delivered", paymentStatus: "paid", placedAt });
    // Unpaid order: counts toward "orders" but not gross sales/AOV.
    await createOrder({ id: 503, userId: customerId, total: "999.00", status: "pending", paymentStatus: "pending", placedAt });
    // Cancelled order: excluded from both.
    await createOrder({ id: 504, userId: customerId, total: "999.00", status: "cancelled", paymentStatus: "pending", placedAt });

    const res = await request(app)
      .get("/api/v1/admin/dashboard/summary?from=2026-06-01&to=2026-06-30")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.isEmpty).toBe(false);
    expect(res.body.data.summary.grossSales.value).toBe(800);
    expect(res.body.data.summary.orders.value).toBe(3); // excludes cancelled
    expect(res.body.data.summary.averageOrderValue.value).toBe(400); // 800 / 2 paid orders
    expect(res.body.data.summary.customers.value).toBe(1);
    expect(res.body.data.timeSeries.current.find((point: { date: string }) => point.date === "2026-06-10")).toMatchObject({
      orders: 3,
      sales: 800
    });
  });

  it("returns order status breakdown including cancelled Orders", async () => {
    const placedAt = new Date("2026-06-11T10:00:00Z");
    await createOrder({ id: 511, userId: customerId, total: "100.00", status: "delivered", paymentStatus: "paid", placedAt });
    await createOrder({ id: 512, userId: customerId, total: "100.00", status: "cancelled", paymentStatus: "pending", placedAt });

    const res = await request(app)
      .get("/api/v1/admin/dashboard/summary?from=2026-06-01&to=2026-06-30")
      .set("Authorization", `Bearer ${adminToken}`);

    const slices: { status: string; count: number }[] = res.body.data.orderStatus;
    expect(slices.find((s) => s.status === "delivered")?.count).toBe(1);
    expect(slices.find((s) => s.status === "cancelled")?.count).toBe(1);
  });

  it("aggregates revenue by ship_state/ship_city into Locations", async () => {
    const placedAt = new Date("2026-06-12T10:00:00Z");
    await createOrder({ id: 521, userId: customerId, total: "200.00", status: "delivered", paymentStatus: "paid", placedAt, state: "Kerala", city: "Kochi" });
    await createOrder({ id: 522, userId: customerId, total: "300.00", status: "delivered", paymentStatus: "paid", placedAt, state: "Kerala", city: "Kochi" });

    const res = await request(app)
      .get("/api/v1/admin/dashboard/summary?from=2026-06-01&to=2026-06-30")
      .set("Authorization", `Bearer ${adminToken}`);

    const kochi = res.body.data.locations.find((l: { state: string; city: string }) => l.state === "Kerala" && l.city === "Kochi");
    expect(kochi).toMatchObject({ orders: 2, customers: 1, revenue: 500, averageOrderValue: 250 });
  });

  it("aggregates units sold and revenue per Product from real OrderItems", async () => {
    const placedAt = new Date("2026-06-13T10:00:00Z");
    const order = await createOrder({ id: 531, userId: customerId, total: "600.00", status: "delivered", paymentStatus: "paid", placedAt });
    await sequelize.transaction(async (t) => {
      const itemId = await IdSequenceService.allocateNextId("order_items", t);
      await OrderItem.create(
        {
          id: itemId,
          order_id: order.id,
          product_id: productId,
          product_name: "Dashboard Test Kibble",
          product_sku: "DASHKIBBLE-001",
          quantity: 3,
          unit_price: "200.00",
          line_total: "600.00"
        },
        { transaction: t }
      );
    });

    const res = await request(app)
      .get("/api/v1/admin/dashboard/summary?from=2026-06-01&to=2026-06-30")
      .set("Authorization", `Bearer ${adminToken}`);

    const row = res.body.data.productPerformance.find((p: { productId: number }) => p.productId === productId);
    expect(row).toMatchObject({ unitsSold: 3, revenue: 600 });
  });

  it("counts open Return Requests within the requested_at range, filterable by state", async () => {
    const placedAt = new Date("2026-06-14T10:00:00Z");
    const order = await createOrder({ id: 541, userId: customerId, total: "400.00", status: "delivered", paymentStatus: "paid", placedAt, state: "Karnataka", city: "Bengaluru" });
    const item = await sequelize.transaction(async (t) => {
      const itemId = await IdSequenceService.allocateNextId("order_items", t);
      return OrderItem.create(
        { id: itemId, order_id: order.id, product_id: productId, product_name: "Dashboard Test Kibble", product_sku: "DASHKIBBLE-001", quantity: 1, unit_price: "400.00", line_total: "400.00" },
        { transaction: t }
      );
    });
    await sequelize.transaction(async (t) => {
      const returnId = await IdSequenceService.allocateNextId("return_requests", t);
      await ReturnRequest.create(
        {
          id: returnId,
          return_number: buildBusinessReference("return", returnId),
          order_id: order.id,
          order_item_id: item.id,
          quantity: 1,
          user_id: customerId,
          type: "return",
          status: "requested",
          reason: "Wrong item shipped",
          requested_at: new Date("2026-06-15T10:00:00Z")
        },
        { transaction: t }
      );
    });

    const res = await request(app)
      .get("/api/v1/admin/dashboard/summary?from=2026-06-01&to=2026-06-30&state=Karnataka")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.body.data.returns.open).toBe(1);

    const filteredOut = await request(app)
      .get("/api/v1/admin/dashboard/summary?from=2026-06-01&to=2026-06-30&state=Kerala")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(filteredOut.body.data.returns.open).toBe(0);
  });

  it("computes previous-period comparison when compare=true", async () => {
    await createOrder({ id: 551, userId: customerId, total: "100.00", status: "delivered", paymentStatus: "paid", placedAt: new Date("2026-06-16T10:00:00Z") });
    await createOrder({ id: 552, userId: customerId, total: "200.00", status: "delivered", paymentStatus: "paid", placedAt: new Date("2026-06-10T10:00:00Z") }); // previous period (2026-06-08..14)

    const res = await request(app)
      .get("/api/v1/admin/dashboard/summary?from=2026-06-15&to=2026-06-21&compare=true")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body.data.summary.grossSales.value).toBe(100);
    expect(res.body.data.summary.grossSales.previousValue).toBe(200);
    expect(res.body.data.summary.grossSales.changePct).toBe(-50);
  });

  it("filters by productId using the same order_items join as Admin Orders", async () => {
    const otherProduct = await request(app)
      .post("/api/v1/admin/products")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ categoryId, name: "Other Dashboard Product", sku: "DASHOTHER-001", description: "Other" });
    const otherProductId = otherProduct.body.data.id;

    const placedAt = new Date("2026-06-17T10:00:00Z");
    const orderA = await createOrder({ id: 561, userId: customerId, total: "100.00", status: "delivered", paymentStatus: "paid", placedAt });
    const orderB = await createOrder({ id: 562, userId: customerId, total: "150.00", status: "delivered", paymentStatus: "paid", placedAt });
    await sequelize.transaction(async (t) => {
      const idA = await IdSequenceService.allocateNextId("order_items", t);
      await OrderItem.create({ id: idA, order_id: orderA.id, product_id: productId, product_name: "A", product_sku: "A", quantity: 1, unit_price: "100.00", line_total: "100.00" }, { transaction: t });
      const idB = await IdSequenceService.allocateNextId("order_items", t);
      await OrderItem.create({ id: idB, order_id: orderB.id, product_id: otherProductId, product_name: "B", product_sku: "B", quantity: 1, unit_price: "150.00", line_total: "150.00" }, { transaction: t });
    });

    const res = await request(app)
      .get(`/api/v1/admin/dashboard/summary?from=2026-06-01&to=2026-06-30&productId=${productId}`)
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.body.data.summary.orders.value).toBe(1);
    expect(res.body.data.summary.grossSales.value).toBe(100);
  });

  it("returns real Products and ship_state values from Filter Options", async () => {
    await createOrder({ id: 571, userId: customerId, total: "100.00", status: "delivered", paymentStatus: "paid", placedAt: new Date(), state: "Goa", city: "Panaji" });

    const res = await request(app).get("/api/v1/admin/dashboard/filter-options").set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.products.some((p: { id: number }) => p.id === productId)).toBe(true);
    expect(res.body.data.states).toContain("Goa");
    expect(res.body.data.orderStatuses).toContain("delivered");
  });
});
