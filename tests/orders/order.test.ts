/* eslint-disable */
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockedShippingConfig = vi.hoisted(() => ({
  provider: "ithink",
  accessToken: "test-access-token",
  secretKey: "test-secret-key",
  apiBaseUrl: "https://pre-alpha.ithinklogistics.com",
  trackingBaseUrl: "https://pre-alpha.ithinklogistics.com",
  storeId: "test-store",
  pickupAddressId: "test-pickup",
  returnAddressId: "test-return",
  originPincode: "400001",
  timeoutMs: 1_000,
  ready: true
}));

vi.mock("../../src/config/shipping.config.js", () => ({ shippingConfig: mockedShippingConfig }));

import { app } from "../../src/app.js";
import { paymentConfig } from "../../src/config/payment.config.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductContentBlock } from "../../src/database/tables/ProductContentBlockTable/index.js";
import { ProductFaq } from "../../src/database/tables/ProductFaqTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductReview } from "../../src/database/tables/ProductReviewTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { Cart } from "../../src/database/tables/CartTable/index.js";
import { CartItem } from "../../src/database/tables/CartItemTable/index.js";
import { Address } from "../../src/database/tables/AddressTable/index.js";
import { Order } from "../../src/database/tables/OrderTable/index.js";
import { OrderItem } from "../../src/database/tables/OrderItemTable/index.js";
import { OrderNote } from "../../src/database/tables/OrderNoteTable/index.js";
import { Payment } from "../../src/database/tables/PaymentTable/index.js";
import { Refund } from "../../src/database/tables/RefundTable/index.js";
import { Shipment } from "../../src/database/tables/ShipmentTable/index.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { IThinkClient } from "../../src/models/ShipmentModels/ithink.client.js";
import { buildPayuResponseHash } from "../../src/models/PaymentModels/payu-hash.util.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS_URL = "/api/v1/storefront/orders";
const ADMIN_ORDERS_URL = "/api/v1/admin/orders";
const CHECKOUT_URL = "/api/v1/storefront/checkout/preview";
const INITIATE_URL = "/api/v1/storefront/payments/initiate";
const WEBHOOK_URL = "/api/v1/payments/payu/webhook";

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      {
        id,
        name: "Order Test Category",
        slug: `order-test-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: "Category for Order backend tests",
        pet_type: "all",
        active: true,
        display_order: 1
      },
      { transaction: t }
    );
  });
  return category.id;
}

async function createSimpleProduct(overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id,
        category_id: categoryId,
        name: `Order Test Simple Product ${skuCounter}`,
        slug: `order-test-simple-${skuCounter}-${Date.now()}`,
        sku: `ORD-SIMPLE-${skuCounter}-${Date.now()}`,
        description: "Simple product for Order tests",
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

async function createVariantProduct(overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id,
        category_id: categoryId,
        name: `Order Test Variant Product ${skuCounter}`,
        slug: `order-test-variant-product-${skuCounter}-${Date.now()}`,
        sku: `ORD-VARPROD-${skuCounter}-${Date.now()}`,
        description: "Variant product for Order tests",
        pet_type: "all",
        status: "active",
        price: "0.00",
        compare_at_price: null,
        stock: 0,
        has_variants: true,
        featured: false,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

async function createVariant(productId: number, overrides: Partial<Record<string, unknown>> = {}): Promise<ProductVariant> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("product_variants", t);
    return ProductVariant.create(
      {
        id,
        product_id: productId,
        name: `Variant ${skuCounter}`,
        sku: `ORD-VAR-${skuCounter}-${Date.now()}`,
        price: "299.00",
        compare_at_price: null,
        stock: 20,
        active: true,
        display_order: 0,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

function validAddressPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    recipientName: "Jordan Rivera",
    phone: "+91 98765 43210",
    line1: "221B Baker Street",
    city: "Mumbai",
    state: "Maharashtra",
    postalCode: "400001",
    ...overrides
  };
}

async function mintCustomerToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const user = await User.create({
    id,
    name: `Order Test Customer ${id}`,
    email,
    password_hash: pwdHash,
    role: "customer",
    status: "active",
    reference_code: `CUS-${id}`
  });
  const { session } = await SessionService.createSession(user.id, "customer", null, null);
  return TokenService.generateAccessToken({
    sub: String(user.id),
    sessionId: String(session.id),
    role: "customer",
    sessionType: "customer"
  });
}

async function mintAdminToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const admin = await User.create({
    id,
    name: `Order Test Admin ${id}`,
    email,
    password_hash: pwdHash,
    role: "admin",
    status: "active",
    reference_code: `ADM-${id}`
  });
  const { session } = await SessionService.createSession(admin.id, "admin", null, null);
  return TokenService.generateAccessToken({
    sub: String(admin.id),
    sessionId: String(session.id),
    role: "admin",
    sessionType: "admin"
  });
}

async function mintSuperAdminToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const admin = await User.create({
    id,
    name: `Order Test Super Admin ${id}`,
    email,
    password_hash: pwdHash,
    role: "super_admin",
    status: "active",
    reference_code: `SUP-${id}`
  });
  const { session } = await SessionService.createSession(admin.id, "admin", null, null);
  return TokenService.generateAccessToken({
    sub: String(admin.id),
    sessionId: String(session.id),
    role: "super_admin",
    sessionType: "admin"
  });
}

/** Adds a Simple Product to the customer's Cart and returns a saved-address-ready payload id. */
async function addSimpleItemAndCreateAddress(
  token: string,
  productOverrides: Partial<Record<string, unknown>> = {},
  quantity = 1
): Promise<{ product: Product; addressId: number }> {
  const product = await createSimpleProduct(productOverrides);
  await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${token}`).send({ productId: product.id, quantity });
  const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${token}`).send(validAddressPayload());
  return { product, addressId: address.body.data.id };
}

/** Places, initiates payment for, and confirms (via the PayU webhook) an Order — leaves it "confirmed" / paid, stock already decremented. */
async function createPaidOrder(
  customerToken: string,
  overrides: { stock?: number; price?: string; quantity?: number } = {}
): Promise<{ orderId: number; productId: number; amount: string }> {
  const product = await createSimpleProduct({ stock: overrides.stock ?? 10, price: overrides.price ?? "500.00" });
  const quantity = overrides.quantity ?? 1;
  await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity });
  const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());
  const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
  const orderId = orderRes.body.data.id;

  const initRes = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerToken}`).send({ orderId });
  const fields = initRes.body.data.fields;
  const hash = buildPayuResponseHash(
    { key: fields.key, txnid: fields.txnid, amount: fields.amount, productinfo: fields.productinfo, firstname: fields.firstname, email: fields.email, udf1: fields.udf1, status: "success" },
    paymentConfig.payuSalt as string
  );
  await request(app)
    .post(WEBHOOK_URL)
    .type("form")
    .send({
      status: "success",
      txnid: fields.txnid,
      amount: fields.amount,
      productinfo: fields.productinfo,
      firstname: fields.firstname,
      email: fields.email,
      udf1: fields.udf1,
      mihpayid: `mihpay_${fields.txnid}`,
      mode: "UPI",
      hash
    });

  return { orderId, productId: product.id, amount: fields.amount };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response;
}

describe("Order Backend Integration Tests", () => {
  let customerAToken: string;
  let customerBToken: string;
  let adminToken: string;
  let superAdminToken: string;
  const CUSTOMER_A_ID = 99601;
  const CUSTOMER_B_ID = 99602;
  const ADMIN_ID = 99603;
  const SUPER_ADMIN_ID = 99604;

  beforeAll(async () => {
    await connectDatabase();

    for (const id of [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID, SUPER_ADMIN_ID]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }

    customerAToken = await mintCustomerToken(CUSTOMER_A_ID, "order-test-customer-a@example.com");
    customerBToken = await mintCustomerToken(CUSTOMER_B_ID, "order-test-customer-b@example.com");
    adminToken = await mintAdminToken(ADMIN_ID, "order-test-admin@example.com");
    superAdminToken = await mintSuperAdminToken(SUPER_ADMIN_ID, "order-test-super-admin@example.com");
  });

  afterAll(async () => {
    await Shipment.destroy({ where: {}, truncate: false, force: true });
    await Refund.destroy({ where: {}, truncate: false, force: true });
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await OrderNote.destroy({ where: {}, truncate: false, force: true });
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await User.destroy({ where: { id: [CUSTOMER_A_ID, CUSTOMER_B_ID, ADMIN_ID, SUPER_ADMIN_ID] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await Shipment.destroy({ where: {}, truncate: false, force: true });
    await Refund.destroy({ where: {}, truncate: false, force: true });
    await OrderNote.destroy({ where: {}, truncate: false, force: true });
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await ProductContentBlock.destroy({ where: {}, truncate: false, force: true });
    await ProductFaq.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    categoryId = await createCategory();
  });

  // ---------------------------------------------------------------------
  // Order creation
  // ---------------------------------------------------------------------
  describe("Order Creation", () => {
    it("treats an unauthenticated Order creation request as guest identity, not as unauthenticated (401)", async () => {
      // Order Creation is guest-compatible by design (see Guest Order Creation
      // describe block below) — an unauthenticated request resolves to a guest
      // Cart identity via resolveCartIdentity(), the same as Checkout Preview.
      // savedAddressId is customer-only, so a guest supplying it is rejected
      // with 400 ORDER_ADDRESS_REQUIRED, never with 401.
      const res = await request(app).post(ORDERS_URL).send({ savedAddressId: 1, contactEmail: "guest@example.com" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("ORDER_ADDRESS_REQUIRED");
    });

    it("rejects Order creation with an empty Cart", async () => {
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_CART_EMPTY");
    });

    it("creates a pending Order from a Simple Product Cart", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 }, 2);
      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("pending");
      expect(res.body.data.paymentStatus).toBe("pending");
      expect(res.body.data.fulfilmentStatus).toBe("unfulfilled");
      expect(res.body.data.orderNumber).toMatch(/^ORD-\d{6}$/);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(2);
    });

    it("rejects an explicitly selected payment method when the Order destination is unserviceable", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const check = vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue([]);
      const beforeOrders = await Order.count();
      const beforeItems = await OrderItem.count();

      const res = await request(app)
        .post(ORDERS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: addressId, paymentMethod: "payu" });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("CHECKOUT_DESTINATION_UNSERVICEABLE");
      expect(await Order.count()).toBe(beforeOrders);
      expect(await OrderItem.count()).toBe(beforeItems);
      expect(check).toHaveBeenCalledWith("400001", "prepaid");
    });

    it("creates a pending Order from a Variant Product Cart", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { stock: 10, price: "299.00" });
      await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, variantId: variant.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      expect(res.status).toBe(201);
      expect(res.body.data.items[0].variantId).toBe(variant.id);
      expect(res.body.data.items[0].variantSku).toBe(variant.sku);
    });

    it("snapshots multiple Cart lines correctly", async () => {
      const productA = await createSimpleProduct({ stock: 10, price: "100.00" });
      const productB = await createSimpleProduct({ stock: 10, price: "50.00" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: productA.id, quantity: 1 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: productB.id, quantity: 3 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      expect(res.body.data.items).toHaveLength(2);
      expect(res.body.data.subtotal).toBe("250.00");
    });

    it("snapshots the customer's saved Address into the Order", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });

      expect(res.body.data.shippingAddress).toMatchObject({
        recipientName: "Jordan Rivera",
        city: "Mumbai",
        state: "Maharashtra",
        country: "IN"
      });
    });

    it("keeps a historical Order's Address snapshot unchanged after the source Address is edited", async () => {
      const { product, addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });
      void product;

      await request(app).patch(`${ADDRESS_URL}/${addressId}`).set("Authorization", `Bearer ${customerAToken}`).send({ city: "Pune" });

      const reloaded = await Order.findByPk(created.body.data.id);
      expect(reloaded?.ship_city).toBe("Mumbai");
    });

    it("keeps a historical Order Item unchanged after the Product name/price/SKU later change", async () => {
      const { product, addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10, price: "499.00" });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });
      const originalName = product.name;
      const originalSku = product.sku;

      product.name = "Renamed Product";
      product.price = "999.00";
      product.sku = `RENAMED-${Date.now()}`;
      await product.save();

      const reloadedItem = await OrderItem.findOne({ where: { order_id: created.body.data.id } });
      expect(reloadedItem?.product_name).toBe(originalName);
      expect(reloadedItem?.unit_price).toBe("499.00");
      expect(reloadedItem?.product_sku).toBe(originalSku);
    });

    it("generates a unique Order number per Order", async () => {
      const first = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const firstOrder = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: first.addressId });

      const second = await addSimpleItemAndCreateAddress(customerBToken, { stock: 10 });
      const secondOrder = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerBToken}`).send({ savedAddressId: second.addressId });

      expect(firstOrder.body.data.orderNumber).not.toBe(secondOrder.body.data.orderNumber);
    });

    it("rejects an unowned savedAddressId", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const bAddress = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerBToken}`).send(validAddressPayload());

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: bAddress.body.data.id });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ORDER_ADDRESS_NOT_FOUND");
    });

    it("rejects client-supplied financial/identity fields on the request body", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10, price: "499.00" });
      const res = await request(app)
        .post(ORDERS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: addressId, total: "1.00", subtotal: "1.00", userId: 99999, orderNumber: "ORD-999999" });

      expect(res.status).toBe(201);
      // Extra fields are simply ignored by Zod's default (non-strict) parsing — client input never reaches pricing/identity.
      expect(res.body.data.total).toBe("499.00");
      expect(res.body.data.orderNumber).not.toBe("ORD-999999");
    });
  });

  // ---------------------------------------------------------------------
  // Stock
  // ---------------------------------------------------------------------
  describe("Stock", () => {
    it("rejects creation when current stock is insufficient", async () => {
      const product = await createSimpleProduct({ stock: 1 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      product.stock = 0;
      await product.save();
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_INSUFFICIENT_STOCK");
    });

    it("blocks creation when the Product becomes Draft after being added to Cart", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      product.status = "draft";
      await product.save();
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_PRODUCT_NOT_AVAILABLE");
    });

    it("blocks creation when the Variant becomes inactive after being added to Cart", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { stock: 10 });
      await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, variantId: variant.id, quantity: 1 });
      variant.active = false;
      await variant.save();
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_VARIANT_NOT_AVAILABLE");
    });

    it("does NOT decrement Product stock on Order creation", async () => {
      const { product, addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 }, 3);
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });

      const reloaded = await Product.findByPk(product.id);
      expect(reloaded?.stock).toBe(10);
    });

    it("does NOT decrement Variant stock on Order creation", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { stock: 10 });
      await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, variantId: variant.id, quantity: 4 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      const reloaded = await ProductVariant.findByPk(variant.id);
      expect(reloaded?.stock).toBe(10);
    });
  });

  // ---------------------------------------------------------------------
  // Cart
  // ---------------------------------------------------------------------
  describe("Cart", () => {
    it("does NOT clear the Cart on pending Order creation", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 }, 2);
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });

      const cart = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(cart.body.data.items).toHaveLength(1);
      expect(cart.body.data.items[0].quantity).toBe(2);
    });

    it("does NOT mark the Cart ordered on pending Order creation", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });

      const cartRow = await Cart.findOne({ where: { user_id: CUSTOMER_A_ID } });
      expect(cartRow?.status).toBe("active");
    });

    it("Cart remains fully readable after Order creation", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });

      const cart = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(cart.status).toBe(200);
      expect(cart.body.data.items[0].available).toBe(true);
    });

    it("persists the exact originating Cart's id onto the new Order (orders.cart_id) — needed so payment finalization never has to re-derive it", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const cartBefore = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });

      const order = await Order.findByPk(res.body.data.id);
      expect(order?.cart_id).toBe(cartBefore.body.data.id);
    });
  });

  // ---------------------------------------------------------------------
  // Money
  // ---------------------------------------------------------------------
  describe("Money", () => {
    it("computes exact decimal line totals and subtotal", async () => {
      const product = await createSimpleProduct({ stock: 10, price: "19.99" });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 3 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      expect(res.body.data.items[0].lineTotal).toBe("59.97");
      expect(res.body.data.subtotal).toBe("59.97");
    });

    it("uses a fixed shipping_fee of 0.00 in V1", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });
      expect(res.body.data.shippingFee).toBe("0.00");
    });

    it("sets total equal to subtotal in V1 (no tax, no discount)", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10, price: "123.45" });
      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });
      expect(res.body.data.total).toBe(res.body.data.subtotal);
    });
  });

  // ---------------------------------------------------------------------
  // Idempotency
  // ---------------------------------------------------------------------
  describe("Idempotency", () => {
    it("rejects a second Order creation while a pending Order already exists for the same customer", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const first = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });
      expect(first.status).toBe(201);

      const second = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("ORDER_ALREADY_PENDING");
    });

    it("does not prevent a different customer from creating their own Order concurrently", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const b = await addSimpleItemAndCreateAddress(customerBToken, { stock: 10 });

      const [resA, resB] = await Promise.all([
        request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId }),
        request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerBToken}`).send({ savedAddressId: b.addressId })
      ]);
      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------
  // Ownership
  // ---------------------------------------------------------------------
  describe("Ownership", () => {
    it("lists only the authenticated customer's own Orders", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app).get(ORDERS_URL).set("Authorization", `Bearer ${customerBToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });

    it("returns the customer's own Order detail", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app).get(`${ORDERS_URL}/${created.body.data.id}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.orderNumber).toBe(created.body.data.orderNumber);
    });

    it("hides another customer's Order as not-found", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app).get(`${ORDERS_URL}/${created.body.data.id}`).set("Authorization", `Bearer ${customerBToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
    });
  });

  // ---------------------------------------------------------------------
  // Admin list / summary
  // ---------------------------------------------------------------------
  describe("Admin Orders List", () => {
    it("rejects a customer token from Admin Orders routes", async () => {
      // authenticate("admin") rejects a wrong-role token as 401 TOKEN_INVALID
      // (existing Auth module behavior — authorize()'s 403 FORBIDDEN is a
      // separate, later gate this route does not use).
      const res = await request(app).get(ADMIN_ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(401);
    });

    it("rejects unauthenticated access", async () => {
      const res = await request(app).get(ADMIN_ORDERS_URL);
      expect(res.status).toBe(401);
    });

    it("returns real summary counts, not fabricated statistics", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app).get(`${ADMIN_ORDERS_URL}/summary`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.pending).toBe(1);
      expect(res.body.data.total).toBe(1);
    });

    it("paginates the Order list", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app).get(`${ADMIN_ORDERS_URL}?page=1&pageSize=1`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.page).toBe(1);
      expect(res.body.data.pageSize).toBe(1);
    });

    it("searches by Order number", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app)
        .get(`${ADMIN_ORDERS_URL}?search=${encodeURIComponent(created.body.data.orderNumber)}`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].orderNumber).toBe(created.body.data.orderNumber);
    });

    it("searches by customer email", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app)
        .get(`${ADMIN_ORDERS_URL}?search=order-test-customer-a`)
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.body.data.items.length).toBeGreaterThanOrEqual(1);
    });

    it("filters by status", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app).get(`${ADMIN_ORDERS_URL}?status=cancelled`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.body.data.items).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // Admin detail
  // ---------------------------------------------------------------------
  describe("Admin Order Detail", () => {
    it("returns full Order detail with item snapshots and customer", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 }, 2);
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app).get(`${ADMIN_ORDERS_URL}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.customer.id).toBe(CUSTOMER_A_ID);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(2);
    });

    it("returns empty arrays (not fabricated rows) for Payments/Shipments/Returns", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app).get(`${ADMIN_ORDERS_URL}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.body.data.payments).toEqual([]);
      expect(res.body.data.shipments).toEqual([]);
      expect(res.body.data.returns).toEqual([]);
    });

    it("returns 404 for a non-existent Order", async () => {
      const res = await request(app).get(`${ADMIN_ORDERS_URL}/999999999`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(404);
    });
  });

  // ---------------------------------------------------------------------
  // Status transitions
  // ---------------------------------------------------------------------
  describe("Status Transitions", () => {
    it("blocks an unpaid online Order from entering fulfilment", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "confirmed" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_PAYMENT_REQUIRED_FOR_FULFILMENT");
    });

    it("blocks an unpaid online Order from jumping straight to delivered", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "delivered" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_PAYMENT_REQUIRED_FOR_FULFILMENT");
    });

    it("allows a paid online Order to enter fulfilment", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });
      await Order.update({ payment_status: "paid" }, { where: { id: created.body.data.id } });

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "confirmed" });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("confirmed");
    });

    it("rejects a backward transition (confirmed -> pending)", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });
      await Order.update({ payment_status: "paid" }, { where: { id: created.body.data.id } });
      await request(app).patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "confirmed" });

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "pending" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_INVALID_STATUS_TRANSITION");
    });

    it("protects a terminal state (cancelled accepts no further transitions)", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });
      await request(app).patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "cancelled" });

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ status: "confirmed" });
      expect(res.status).toBe(422);
    });

    it("persists cancelled_at when cancelling", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      await request(app).patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "cancelled" });

      const reloaded = await Order.findByPk(created.body.data.id);
      expect(reloaded?.cancelled_at).not.toBeNull();
    });

    it("cancelling an UNPAID Order never touches stock (nothing was decremented for it yet) — see 'Paid Order Cancellation' below for the paid case", async () => {
      const { product, addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 }, 3);
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });

      await request(app).patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "cancelled" });

      const reloadedProduct = await Product.findByPk(product.id);
      expect(reloadedProduct?.stock).toBe(10); // unchanged — was never decremented in the first place
    });

    it("persists status after refresh (repeated GET)", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });
      await Order.update({ payment_status: "paid" }, { where: { id: created.body.data.id } });
      await request(app).patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "confirmed" });

      const first = await request(app).get(`${ADMIN_ORDERS_URL}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`);
      const second = await request(app).get(`${ADMIN_ORDERS_URL}/${created.body.data.id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(first.body.data.status).toBe("confirmed");
      expect(second.body.data.status).toBe("confirmed");
    });

    it("rejects status transitions from a customer token", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ status: "confirmed" });
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------
  // Paid Order Cancellation — auto stock-restore + auto refund trigger
  // ---------------------------------------------------------------------
  describe("Paid Order Cancellation (stock restore + refund)", () => {
    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it("rejects a plain admin cancelling a paid Order — super_admin is required once money is involved", async () => {
      const { orderId, productId } = await createPaidOrder(customerAToken, { stock: 10, quantity: 3 });
      expect((await Product.findByPk(productId))!.stock).toBe(7); // decremented on payment confirmation

      const res = await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "cancelled" });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("ORDER_CANCEL_REQUIRES_SUPER_ADMIN");

      const order = await Order.findByPk(orderId);
      expect(order!.status).toBe("confirmed"); // unchanged — the cancellation itself was rejected
      expect((await Product.findByPk(productId))!.stock).toBe(7); // unchanged
      expect(fetch).not.toHaveBeenCalled(); // no refund was ever attempted
    });

    it("a super_admin cancelling a paid Order restores stock and creates a pending Refund for the full captured amount", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_cancel_1" }));
      const { orderId, productId } = await createPaidOrder(customerAToken, { stock: 10, price: "500.00", quantity: 3 });
      expect((await Product.findByPk(productId))!.stock).toBe(7);

      const res = await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${superAdminToken}`).send({ status: "cancelled" });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("cancelled");

      expect((await Product.findByPk(productId))!.stock).toBe(10); // fully restored

      const refund = await Refund.findOne({ where: { order_id: orderId } });
      expect(refund).not.toBeNull();
      expect(refund!.amount).toBe("1500.00"); // 500.00 x 3 — the full captured Payment amount
      expect(refund!.return_request_id).toBeNull(); // no Return involved — cancellation-triggered
      expect(["pending", "processing"]).toContain(refund!.status);
      expect(fetch).toHaveBeenCalledTimes(1); // refund was actually dispatched to PayU
    });

    it("a genuine SUCCESS from PayU rolls the cancelled Order's payment status up to 'refunded'", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ status: 1, request_id: "req_cancel_2" }));
      const { orderId } = await createPaidOrder(customerAToken, { stock: 10, price: "500.00", quantity: 1 });

      await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${superAdminToken}`).send({ status: "cancelled" });
      const refund = await Refund.findOne({ where: { order_id: orderId } });

      vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({ status: 1, transaction_details: { req_cancel_2: { status: "SUCCESS", amt: "500.00", mihpayid: "mihpay1" } } }));
      await request(app).post(`/api/v1/admin/refunds/${refund!.id}/recheck`).set("Authorization", `Bearer ${superAdminToken}`).send({});

      const order = await Order.findByPk(orderId);
      expect(order!.status).toBe("cancelled"); // order status itself is untouched by refund finalization
      expect(order!.payment_status).toBe("refunded");

      const payment = await Payment.findOne({ where: { order_id: orderId } });
      expect(payment!.status).toBe("refunded");
    });

    it("does not create a second refund or call PayU twice for the same cancelled Order", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_cancel_3" }));
      const { orderId } = await createPaidOrder(customerAToken, { stock: 10, quantity: 1 });

      await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${superAdminToken}`).send({ status: "cancelled" });
      // cancelled is terminal — a second attempt must be rejected before any refund/stock logic re-runs.
      const second = await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${superAdminToken}`).send({ status: "cancelled" });
      expect(second.status).toBe(422);
      expect(second.body.error.code).toBe("ORDER_INVALID_STATUS_TRANSITION");

      const refundCount = await Refund.count({ where: { order_id: orderId } });
      expect(refundCount).toBe(1);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("bulk-cancel skips a paid Order for a plain admin but still cancels an unpaid one in the same batch", async () => {
      const { orderId: paidOrderId, productId } = await createPaidOrder(customerAToken, { stock: 10, quantity: 2 });
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 5 });
      const unpaidOrderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });
      const unpaidOrderId = unpaidOrderRes.body.data.id;

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/bulk-status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: [paidOrderId, unpaidOrderId], status: "cancelled" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ updated: 1, skipped: 1 });

      const paidOrder = await Order.findByPk(paidOrderId);
      expect(paidOrder!.status).toBe("confirmed"); // skipped, still requires super_admin
      expect((await Product.findByPk(productId))!.stock).toBe(8); // untouched

      const unpaidOrder = await Order.findByPk(unpaidOrderId);
      expect(unpaidOrder!.status).toBe("cancelled");
      expect(fetch).not.toHaveBeenCalled(); // no refund was ever eligible in this batch
    });

    it("bulk-cancel by a super_admin restores stock and creates a Refund for every paid Order in the batch", async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_cancel_bulk" }));
      const first = await createPaidOrder(customerAToken, { stock: 10, price: "500.00", quantity: 1 });
      const second = await createPaidOrder(customerBToken, { stock: 10, price: "500.00", quantity: 1 });

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/bulk-status`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ ids: [first.orderId, second.orderId], status: "cancelled" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ updated: 2, skipped: 0 });

      expect((await Product.findByPk(first.productId))!.stock).toBe(10);
      expect((await Product.findByPk(second.productId))!.stock).toBe(10);
      expect(await Refund.count()).toBe(2);
      expect(fetch).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------
  // Pending Order Cancellation — customer + guest self-service (Stage 1.5)
  // ---------------------------------------------------------------------
  describe("Pending Order Cancellation (customer + guest self-service)", () => {
    const INITIATE_PATH = "/api/v1/storefront/payments/initiate";
    const COD_PATH = "/api/v1/storefront/payments/cod";
    const cancelUrl = (orderId: number | string) => `${ORDERS_URL}/${orderId}/cancel`;
    const guestCancelUrl = (token: string) => `${ORDERS_URL}/guest/${token}/cancel`;

    beforeEach(() => {
      vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    async function createCustomerPendingOrder(
      token: string,
      overrides: { stock?: number; quantity?: number } = {}
    ): Promise<{ orderId: number; productId: number }> {
      const { product, addressId } = await addSimpleItemAndCreateAddress(
        token,
        { stock: overrides.stock ?? 10 },
        overrides.quantity ?? 1
      );
      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${token}`).send({ savedAddressId: addressId });
      expect(res.status).toBe(201);
      return { orderId: res.body.data.id, productId: product.id };
    }

    async function createGuestPendingOrder(): Promise<{ agent: ReturnType<typeof request.agent>; orderId: number; token: string; productId: number }> {
      const product = await createSimpleProduct({ stock: 10 });
      const agent = request.agent(app);
      await agent.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
      const res = await agent.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      expect(res.status).toBe(201);
      return { agent, orderId: res.body.data.id, token: res.body.data.guestAccessToken, productId: product.id };
    }

    /** Runs PayU initiation for an Order — leaves a provider:"payu" status:"pending" Payment with a provider_order_id. */
    async function initiatePayu(opts: { orderId: number; customerToken?: string; guestToken?: string }): Promise<{ txnid: string; amount: string }> {
      const httpReq = request(app).post(INITIATE_PATH);
      if (opts.customerToken) httpReq.set("Authorization", `Bearer ${opts.customerToken}`);
      const res = await httpReq.send(opts.guestToken ? { guestAccessToken: opts.guestToken } : { orderId: opts.orderId });
      expect(res.status).toBe(200);
      return { txnid: res.body.data.fields.txnid, amount: res.body.data.fields.amount };
    }

    function stubVerify(txnid: string, providerStatus: "success" | "failure", amount: string) {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ status: 1, transaction_details: { [txnid]: { mihpayid: `mihpay_${txnid}`, status: providerStatus, amt: amount, mode: "UPI" } } })
      );
    }
    function stubVerifyUnavailable() {
      vi.mocked(fetch).mockRejectedValue(new Error("PayU Verify network failure"));
    }

    // --- Authenticated customer (§36) ---------------------------------------

    it("1. cancels the customer's own pending Order with no payment attempt; Cart stays active", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);

      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("cancelled");
      expect(res.body.data.cancelledAt).not.toBeNull();

      const order = await Order.findByPk(orderId);
      expect(order!.status).toBe("cancelled");
      expect(order!.cancelled_at).not.toBeNull();

      const cart = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(cart.body.data.items).toHaveLength(1);
      const cartRow = await Cart.findOne({ where: { user_id: CUSTOMER_A_ID } });
      expect(cartRow!.status).toBe("active");
    });

    it("2. a cancelled Order no longer blocks creating a new Order", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      const blocked = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: (await Address.findOne({ where: { user_id: CUSTOMER_A_ID } }))!.id });
      expect(blocked.body.error.code).toBe("ORDER_ALREADY_PENDING");

      await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});

      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 5 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });
      expect(created.status).toBe(201);
      expect(created.body.data.id).not.toBe(orderId);
      expect(created.body.data.status).toBe("pending");
    });

    it("3. a customer cannot cancel another customer's Order (same safe 404 as an unknown Order)", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerBToken}`).send({});
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("ORDER_NOT_FOUND");
      expect((await Order.findByPk(orderId))!.status).toBe("pending");
    });

    it("4. cancellation is idempotent — a repeat request returns the cancelled Order, not an error", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      const first = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      const second = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.status).toBe("cancelled");
    });

    it("5. a confirmed (paid) Order is rejected by the pending-cancel endpoint", async () => {
      const { orderId } = await createPaidOrder(customerAToken, { stock: 10, quantity: 1 });
      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect([409, 422]).toContain(res.status);
      expect(["ORDER_ALREADY_PAID", "ORDER_NOT_CANCELLABLE"]).toContain(res.body.error.code);
      expect((await Order.findByPk(orderId))!.status).toBe("confirmed");
    });

    it("6. a processing Order is rejected by the pending-cancel endpoint", async () => {
      const { orderId } = await createPaidOrder(customerAToken, { stock: 10, quantity: 1 });
      await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "processing" });
      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_NOT_CANCELLABLE");
      expect((await Order.findByPk(orderId))!.status).toBe("processing");
    });

    // --- PayU (§37) --------------------------------------------------------

    it("7. a pending Order whose PayU attempt is terminal-failed can be cancelled (no reconciliation call)", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      const { txnid } = await initiatePayu({ orderId, customerToken: customerAToken });
      await Payment.update({ status: "failed", failed_at: new Date() }, { where: { provider_order_id: txnid } });

      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("cancelled");
      expect(fetch).not.toHaveBeenCalled();
    });

    it("8. a pending Order whose PayU attempt is terminal-cancelled can be cancelled", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      const { txnid } = await initiatePayu({ orderId, customerToken: customerAToken });
      await Payment.update({ status: "cancelled", failed_at: new Date() }, { where: { provider_order_id: txnid } });

      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("cancelled");
    });

    it("9. a still-pending PayU attempt is reconciled against PayU before the cancellation decision", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      const { txnid, amount } = await initiatePayu({ orderId, customerToken: customerAToken });
      stubVerify(txnid, "failure", amount);

      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("cancelled");
      expect(fetch).toHaveBeenCalled(); // Verify Payment API was consulted
      expect((await Payment.findOne({ where: { provider_order_id: txnid } }))!.status).toBe("failed");
    });

    it("10. reconciliation that returns PAID blocks cancellation; the Order ends provider-authoritative paid", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      const { txnid, amount } = await initiatePayu({ orderId, customerToken: customerAToken });
      stubVerify(txnid, "success", amount);

      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("ORDER_ALREADY_PAID");

      const order = await Order.findByPk(orderId);
      expect(order!.payment_status).toBe("paid");
      expect(order!.status).not.toBe("cancelled");
      expect((await Payment.findOne({ where: { provider_order_id: txnid } }))!.status).toBe("paid");
    });

    it("11. an uncertain/unavailable PayU Verify result blocks cancellation with a retryable error", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      const { txnid } = await initiatePayu({ orderId, customerToken: customerAToken });
      stubVerifyUnavailable();

      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("PAYMENT_STATUS_UNCERTAIN");

      const order = await Order.findByPk(orderId);
      expect(order!.status).toBe("pending"); // untouched
      expect((await Payment.findOne({ where: { provider_order_id: txnid } }))!.status).toBe("pending"); // untouched
    });

    it("12. a payment finalized paid before the cancel request cannot produce a cancelled+unpaid Order", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      const { txnid } = await initiatePayu({ orderId, customerToken: customerAToken });
      // Simulate the webhook/finalization having committed first.
      await Payment.update({ status: "paid", paid_at: new Date() }, { where: { provider_order_id: txnid } });
      await Order.update({ status: "confirmed", payment_status: "paid" }, { where: { id: orderId } });

      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect([409, 422]).toContain(res.status);
      const order = await Order.findByPk(orderId);
      expect(order!.status).not.toBe("cancelled");
      expect(order!.payment_status).toBe("paid");
    });

    // --- COD (§38) --------------------------------------------------------

    it("13-15. a confirmed COD Order is rejected; its COD Payment and stock are untouched", async () => {
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["test-courier"]);
      const { orderId, productId } = await createCustomerPendingOrder(customerAToken, { stock: 10, quantity: 3 });
      const cod = await request(app).post(COD_PATH).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      expect(cod.status).toBe(200);
      expect((await Product.findByPk(productId))!.stock).toBe(7); // decremented on COD confirmation
      const codPaymentBefore = await Payment.findOne({ where: { order_id: orderId, provider: "cod" } });

      const res = await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_NOT_CANCELLABLE");

      const order = await Order.findByPk(orderId);
      expect(order!.status).toBe("confirmed");
      expect(order!.payment_status).toBe("pending"); // COD stays pending, never mistaken for unpaid-online
      expect((await Product.findByPk(productId))!.stock).toBe(7); // NOT restored
      const codPaymentAfter = await Payment.findOne({ where: { order_id: orderId, provider: "cod" } });
      expect(codPaymentAfter!.status).toBe(codPaymentBefore!.status);
    });

    // --- Cart / inventory (§39) ------------------------------------------

    it("16-18. cancelling an unpaid pending online Order leaves stock, Cart and CartItems untouched", async () => {
      const { orderId, productId } = await createCustomerPendingOrder(customerAToken, { stock: 8, quantity: 2 });
      const stockBefore = (await Product.findByPk(productId))!.stock;
      const cartItemsBefore = await CartItem.count();

      await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});

      expect((await Product.findByPk(productId))!.stock).toBe(stockBefore);
      expect(await CartItem.count()).toBe(cartItemsBefore);
      const cart = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(cart.body.data.items).toHaveLength(1);
      expect((await Cart.findOne({ where: { user_id: CUSTOMER_A_ID } }))!.status).toBe("active");
    });

    it("19-20. after cancellation the customer can modify the Cart and create a fresh pending Order", async () => {
      const { orderId } = await createCustomerPendingOrder(customerAToken);
      await request(app).post(cancelUrl(orderId)).set("Authorization", `Bearer ${customerAToken}`).send({});

      const another = await createSimpleProduct({ stock: 10 });
      const add = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: another.id, quantity: 1 });
      expect([200, 201]).toContain(add.status);

      const addr = await Address.findOne({ where: { user_id: CUSTOMER_A_ID } });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addr!.id });
      expect(created.status).toBe(201);
      expect(created.body.data.items.length).toBeGreaterThanOrEqual(2);
    });

    // --- Guest (§40) -----------------------------------------------------

    it("21. a guest can cancel their own pending Order with a valid recovery token", async () => {
      const { token, orderId } = await createGuestPendingOrder();
      const res = await request(app).post(guestCancelUrl(token)).send({});
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(orderId);
      expect(res.body.data.status).toBe("cancelled");
      expect(res.body.data.shippingAddress.latitude).toBeUndefined(); // guest-safe DTO
    });

    it("22. an invalid/unknown guest token cannot cancel any Order", async () => {
      const { orderId } = await createGuestPendingOrder();
      const bad = await request(app).post(guestCancelUrl(crypto.randomBytes(32).toString("hex"))).send({});
      expect(bad.status).toBe(404);
      expect(bad.body.error.code).toBe("GUEST_ORDER_NOT_FOUND");
      const malformed = await request(app).post(guestCancelUrl("not-a-real-token")).send({});
      expect(malformed.status).toBe(404);
      expect((await Order.findByPk(orderId))!.status).toBe("pending");
    });

    it("23. one guest's token cannot cancel a different guest's Order", async () => {
      const guestA = await createGuestPendingOrder();
      const guestB = await createGuestPendingOrder();
      const res = await request(app).post(guestCancelUrl(guestB.token)).send({});
      // token B only ever resolves to order B
      expect(res.body.data.id).toBe(guestB.orderId);
      expect((await Order.findByPk(guestA.orderId))!.status).toBe("pending");
    });

    it("24. a guest paid Order cannot be cancelled through the pending-cancel endpoint", async () => {
      const { token, orderId } = await createGuestPendingOrder();
      const { txnid } = await initiatePayu({ orderId, guestToken: token });
      await Payment.update({ status: "paid", paid_at: new Date() }, { where: { provider_order_id: txnid } });
      await Order.update({ status: "confirmed", payment_status: "paid" }, { where: { id: orderId } });

      const res = await request(app).post(guestCancelUrl(token)).send({});
      expect([409, 422]).toContain(res.status);
      expect((await Order.findByPk(orderId))!.status).toBe("confirmed");
    });

    it("25. a guest cancellation releases the one-pending-Order block for that guest identity", async () => {
      const { agent, orderId } = await createGuestPendingOrder();
      // Same guest identity, repeated create → returns the same pending Order,
      // rotating the recovery token (see Guest Order Idempotency) — use the
      // freshest token to cancel.
      const blocked = await agent.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      expect(blocked.body.data.id).toBe(orderId);

      const cancel = await request(app).post(guestCancelUrl(blocked.body.data.guestAccessToken)).send({});
      expect(cancel.status).toBe(200);

      const another = await createSimpleProduct({ stock: 10 });
      await agent.post(`${CART_URL}/items`).send({ productId: another.id, quantity: 1 });
      const fresh = await agent.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      expect(fresh.status).toBe(201);
      expect(fresh.body.data.id).not.toBe(orderId);
      expect(fresh.body.data.status).toBe("pending");
    });
  });

  // ---------------------------------------------------------------------
  // Notes
  // ---------------------------------------------------------------------
  describe("Order Notes", () => {
    it("lets an Admin add a note", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app)
        .post(`${ADMIN_ORDERS_URL}/${created.body.data.id}/notes`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ message: "Called customer to confirm delivery window." });
      expect(res.status).toBe(201);
      expect(res.body.data.message).toBe("Called customer to confirm delivery window.");
      expect(res.body.data.authorId).toBe(ADMIN_ID);
    });

    it("rejects a customer trying to add an Admin note", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app)
        .post(`${ADMIN_ORDERS_URL}/${created.body.data.id}/notes`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ message: "Not allowed" });
      expect(res.status).toBe(401);
    });
  });

  // ---------------------------------------------------------------------
  // Bulk status
  // ---------------------------------------------------------------------
  describe("Bulk Status", () => {
    it("returns updated/skipped counts, skipping illegal per-item transitions", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });
      await request(app).patch(`${ADMIN_ORDERS_URL}/${created.body.data.id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "cancelled" });

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/bulk-status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: [created.body.data.id], status: "confirmed" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ updated: 0, skipped: 1 });
    });

    it("skips an unpaid online Order when bulk fulfilment status is requested", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const created = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/bulk-status`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ ids: [created.body.data.id], status: "processing" });

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ updated: 0, skipped: 1 });
      expect((await Order.findByPk(created.body.data.id))?.status).toBe("pending");
    });
  });

  // -------------------------------------------------------------------------
  // Coordinate Snapshot Tests
  // -------------------------------------------------------------------------
  describe("Order Coordinate Snapshot", () => {
    it("order creation snapshots latitude and longitude from the saved address", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app)
        .post(ADDRESS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send(validAddressPayload({ latitude: 19.076, longitude: 72.8777 }));

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      expect(res.status).toBe(201);
      expect(typeof res.body.data.shippingAddress.latitude).toBe("number");
      expect(typeof res.body.data.shippingAddress.longitude).toBe("number");
      expect(res.body.data.shippingAddress.latitude).toBeCloseTo(19.076, 4);
      expect(res.body.data.shippingAddress.longitude).toBeCloseTo(72.8777, 4);
    });

    it("order from address with null coordinates has null ship_latitude and ship_longitude", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app)
        .post(ADDRESS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send(validAddressPayload());

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      expect(res.status).toBe(201);
      expect(res.body.data.shippingAddress.latitude).toBeNull();
      expect(res.body.data.shippingAddress.longitude).toBeNull();
    });

    it("editing address coordinates after order creation does not change the historical order snapshot", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app)
        .post(ADDRESS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send(validAddressPayload({ latitude: 19.076, longitude: 72.8777 }));

      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      expect(orderRes.status).toBe(201);
      const orderId: number = orderRes.body.data.id;

      // Now update the address to different coordinates
      await request(app)
        .patch(`${ADDRESS_URL}/${address.body.data.id}`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ latitude: 28.6139, longitude: 77.209 });

      // Fetch the historical order — its snapshot must still show the original coordinates
      const fetchedOrder = await request(app).get(`${ORDERS_URL}/${orderId}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(fetchedOrder.status).toBe(200);
      expect(fetchedOrder.body.data.shippingAddress.latitude).toBeCloseTo(19.076, 4);
      expect(fetchedOrder.body.data.shippingAddress.longitude).toBeCloseTo(72.8777, 4);
    });

    it("clearing address coordinates after order creation does not affect the historical order snapshot", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app)
        .post(ADDRESS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send(validAddressPayload({ latitude: 12.9716, longitude: 77.5946 }));

      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      expect(orderRes.status).toBe(201);
      const orderId: number = orderRes.body.data.id;

      // Clear coordinates from the address
      await request(app)
        .patch(`${ADDRESS_URL}/${address.body.data.id}`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ latitude: null, longitude: null });

      // Historical order still has the snapshotted coordinates
      const fetchedOrder = await request(app).get(`${ORDERS_URL}/${orderId}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(fetchedOrder.status).toBe(200);
      expect(fetchedOrder.body.data.shippingAddress.latitude).toBeCloseTo(12.9716, 4);
      expect(fetchedOrder.body.data.shippingAddress.longitude).toBeCloseTo(77.5946, 4);
    });

    // Proves the `orders.ship_longitude DECIMAL(10,6)` column actually persists/snapshots
    // the full ±180 longitude range, not just values that would also fit in DECIMAL(9,6).
    it("order creation snapshots a boundary longitude of 180 correctly", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app)
        .post(ADDRESS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send(validAddressPayload({ latitude: 90, longitude: 180 }));

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      expect(res.status).toBe(201);
      expect(res.body.data.shippingAddress.longitude).toBeCloseTo(180, 4);

      const fetchedOrder = await request(app).get(`${ORDERS_URL}/${res.body.data.id}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(fetchedOrder.status).toBe(200);
      expect(fetchedOrder.body.data.shippingAddress.longitude).toBeCloseTo(180, 4);
    });

    it("order creation snapshots a boundary longitude of -180 correctly", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app)
        .post(ADDRESS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send(validAddressPayload({ latitude: -90, longitude: -180 }));

      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      expect(res.status).toBe(201);
      expect(res.body.data.shippingAddress.longitude).toBeCloseTo(-180, 4);

      const fetchedOrder = await request(app).get(`${ORDERS_URL}/${res.body.data.id}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(fetchedOrder.status).toBe(200);
      expect(fetchedOrder.body.data.shippingAddress.longitude).toBeCloseTo(-180, 4);
    });
  });

  // ---------------------------------------------------------------------
  // Guest Order Creation
  // ---------------------------------------------------------------------
  describe("Guest Order Creation", () => {
    async function guestAgentWithItem(productId: number, quantity = 1, variantId?: number) {
      const agent = request.agent(app);
      await agent.post(`${CART_URL}/items`).send(variantId !== undefined ? { productId, variantId, quantity } : { productId, quantity });
      return agent;
    }

    it("creates a pending Order for a guest with an inline shipping address", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 2);

      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });

      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe("pending");
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(2);
      expect(res.body.data.shippingAddress).toMatchObject({
        recipientName: "Jordan Rivera",
        city: "Mumbai",
        state: "Maharashtra",
        country: "IN"
      });
    });

    it("snapshots guest inline shipping coordinates", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload({ latitude: 19.076, longitude: 72.8777 }), contactEmail: "guest@example.com" });

      expect(res.status).toBe(201);
      expect(res.body.data.shippingAddress.latitude).toBeCloseTo(19.076, 4);
      expect(res.body.data.shippingAddress.longitude).toBeCloseTo(72.8777, 4);
    });

    it("rejects guest Order creation with no address at all", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      const res = await guest.post(ORDERS_URL).send({});
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUTH_VALIDATION_FAILED");
    });

    it("rejects guest Order creation without contactEmail", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload() });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("ORDER_EMAIL_REQUIRED");
    });

    it("rejects a guest supplying savedAddressId instead of an inline address", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const savedByCustomer = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const guest = await guestAgentWithItem(product.id, 1);

      const res = await guest.post(ORDERS_URL).send({ savedAddressId: savedByCustomer.body.data.id, contactEmail: "guest@example.com" });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("ORDER_ADDRESS_REQUIRED");
    });

    it("rejects guest Order creation with an empty Cart", async () => {
      const guest = request.agent(app);
      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_CART_EMPTY");
    });

    it("rejects guest Order creation when the Product becomes unavailable after being added to Cart", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);
      product.status = "draft";
      await product.save();

      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_PRODUCT_NOT_AVAILABLE");
    });

    it("snapshots a guest Variant Order line correctly", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { stock: 10, price: "299.00" });
      const guest = await guestAgentWithItem(product.id, 1, variant.id);

      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });

      expect(res.status).toBe(201);
      expect(res.body.data.items[0].variantId).toBe(variant.id);
      expect(res.body.data.items[0].variantSku).toBe(variant.sku);
    });

    it("does not persist a user_id for a guest Order", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      expect(res.status).toBe(201);

      const reloaded = await Order.findByPk(res.body.data.id);
      expect(reloaded?.user_id).toBeNull();
    });

    it("returns a guestAccessToken on Order creation, and does not persist it as plaintext", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      expect(res.status).toBe(201);
      expect(typeof res.body.data.guestAccessToken).toBe("string");
      expect(res.body.data.guestAccessToken).toMatch(/^[a-f0-9]{64}$/);

      const reloaded = await Order.findByPk(res.body.data.id);
      expect(reloaded?.guest_access_token_hash).not.toBe(res.body.data.guestAccessToken);
      expect(reloaded?.guest_access_token_hash).toMatch(/^[a-f0-9]{64}$/);
      expect(reloaded?.guest_identity_hash).toBeTruthy();
    });

    it("a customer Order creation response never includes a guestAccessToken", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const res = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });
      expect(res.status).toBe(201);
      expect(res.body.data.guestAccessToken).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // Guest Order Idempotency (see order.service.ts createOrder doc comment)
  // ---------------------------------------------------------------------
  describe("Guest Order Idempotency", () => {
    async function guestAgentWithItem(productId: number, quantity = 1) {
      const agent = request.agent(app);
      await agent.post(`${CART_URL}/items`).send({ productId, quantity });
      return agent;
    }

    it("a repeated guest Order creation request does not create a second Order", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      const first = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      const second = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.data.id).toBe(first.body.data.id);

      const count = await Order.count({ where: { guest_identity_hash: (await Order.findByPk(first.body.data.id))!.guest_identity_hash } });
      expect(count).toBe(1);
    });

    it("rotates the guestAccessToken on a repeated request, invalidating the previous one", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      const first = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      const second = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });

      expect(second.body.data.guestAccessToken).not.toBe(first.body.data.guestAccessToken);

      const staleLookup = await request(app).get(`${ORDERS_URL}/guest/${first.body.data.guestAccessToken}`);
      expect(staleLookup.status).toBe(404);

      const freshLookup = await request(app).get(`${ORDERS_URL}/guest/${second.body.data.guestAccessToken}`);
      expect(freshLookup.status).toBe(200);
      expect(freshLookup.body.data.id).toBe(first.body.data.id);
    });

    it("three rapid repeated requests from the same guest still resolve to exactly one Order", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      const [a, b, c] = await Promise.all([
        guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" }),
        guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" }),
        guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" })
      ]);

      expect([a.status, b.status, c.status]).toEqual([201, 201, 201]);
      const ids = new Set([a.body.data.id, b.body.data.id, c.body.data.id]);
      expect(ids.size).toBe(1);

      const identityHash = (await Order.findByPk(a.body.data.id))!.guest_identity_hash;
      const count = await Order.count({ where: { guest_identity_hash: identityHash } });
      expect(count).toBe(1);
    });

    it("two different guests each get their own independent Order, unaffected by each other", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guestA = await guestAgentWithItem(product.id, 1);
      const guestB = await guestAgentWithItem(product.id, 1);

      const [resA, resB] = await Promise.all([
        guestA.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" }),
        guestB.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" })
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);
      expect(resA.body.data.id).not.toBe(resB.body.data.id);
      expect(resA.body.data.guestAccessToken).not.toBe(resB.body.data.guestAccessToken);
    });

    it("customer pending-Order behavior is unaffected by the guest idempotency change", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const first = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });
      const second = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: addressId });

      expect(first.status).toBe(201);
      expect(second.status).toBe(409);
      expect(second.body.error.code).toBe("ORDER_ALREADY_PENDING");
    });
  });

  // ---------------------------------------------------------------------
  // Guest Order Recovery (GET /storefront/orders/guest/:token)
  // ---------------------------------------------------------------------
  describe("Guest Order Recovery", () => {
    async function createGuestOrderWithToken(): Promise<{ orderId: number; token: string }> {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = request.agent(app);
      await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload({ latitude: 19.076, longitude: 72.8777 }), contactEmail: "guest@example.com" });
      return { orderId: res.body.data.id, token: res.body.data.guestAccessToken };
    }

    it("retrieves the guest Order by its recovery token", async () => {
      const { orderId, token } = await createGuestOrderWithToken();
      const res = await request(app).get(`${ORDERS_URL}/guest/${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(orderId);
      expect(res.body.data.status).toBe("pending");
    });

    it("does not expose shipping coordinates through the guest recovery route", async () => {
      const { token } = await createGuestOrderWithToken();
      const res = await request(app).get(`${ORDERS_URL}/guest/${token}`);
      expect(res.status).toBe(200);
      expect(res.body.data.shippingAddress.latitude).toBeUndefined();
      expect(res.body.data.shippingAddress.longitude).toBeUndefined();
    });

    it("supports repeated lookups (refresh-style) with the same token", async () => {
      const { orderId, token } = await createGuestOrderWithToken();
      const first = await request(app).get(`${ORDERS_URL}/guest/${token}`);
      const second = await request(app).get(`${ORDERS_URL}/guest/${token}`);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(first.body.data.id).toBe(orderId);
      expect(second.body.data.id).toBe(orderId);
    });

    it("returns a safe 404 for a well-formed but unknown token", async () => {
      const randomToken = crypto.randomBytes(32).toString("hex");
      const res = await request(app).get(`${ORDERS_URL}/guest/${randomToken}`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("GUEST_ORDER_NOT_FOUND");
    });

    it("returns the same safe 404 for a malformed token, without leaking format validity", async () => {
      const res = await request(app).get(`${ORDERS_URL}/guest/not-a-real-token`);
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("GUEST_ORDER_NOT_FOUND");
    });

    it("does not let one guest's token retrieve a different guest's Order", async () => {
      const orderA = await createGuestOrderWithToken();
      const orderB = await createGuestOrderWithToken();

      const res = await request(app).get(`${ORDERS_URL}/guest/${orderA.token}`);
      expect(res.body.data.id).toBe(orderA.orderId);
      expect(res.body.data.id).not.toBe(orderB.orderId);
    });

    it("a guest token cannot be used against the customer-authenticated order routes, and a numeric ID alone cannot retrieve a guest Order", async () => {
      const { orderId } = await createGuestOrderWithToken();

      const byIdNoAuth = await request(app).get(`${ORDERS_URL}/${orderId}`);
      expect(byIdNoAuth.status).toBe(401);

      const byIdAsCustomer = await request(app).get(`${ORDERS_URL}/${orderId}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(byIdAsCustomer.status).toBe(404);
    });

    it("a forged/unknown guest Cart cookie cannot be used to discover or block another guest's pending Order", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const legitGuest = request.agent(app);
      await legitGuest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
      const legit = await legitGuest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      expect(legit.status).toBe(201);

      // A stranger presenting an arbitrary, never-issued guest cookie value
      // resolves to their own brand-new guest identity (resolveCartIdentity
      // hashes whatever cookie is presented) — it never collides with, blocks,
      // or exposes the legitimate guest's pending Order or token.
      const strangerCartAdd = await request(app)
        .post(`${CART_URL}/items`)
        .set("Cookie", `mypetmart_guest_cart=${"f".repeat(64)}`)
        .send({ productId: product.id, quantity: 1 });
      const strangerOrder = await request(app)
        .post(ORDERS_URL)
        .set("Cookie", strangerCartAdd.headers["set-cookie"] ?? `mypetmart_guest_cart=${"f".repeat(64)}`)
        .send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });

      expect(strangerOrder.status).toBe(201);
      expect(strangerOrder.body.data.id).not.toBe(legit.body.data.id);
      expect(strangerOrder.body.data.guestAccessToken).not.toBe(legit.body.data.guestAccessToken);
    });
  });

  // ---------------------------------------------------------------------
  // Customer Inline Address Order Creation
  // ---------------------------------------------------------------------
  describe("Customer Inline Address Order Creation", () => {
    it("creates a pending Order for an authenticated customer using an inline shipping address with no saved Address", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });

      const res = await request(app)
        .post(ORDERS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ shippingAddress: validAddressPayload() });

      expect(res.status).toBe(201);
      expect(res.body.data.shippingAddress).toMatchObject({ recipientName: "Jordan Rivera", city: "Mumbai" });
    });

    it("snapshots inline coordinates for an authenticated customer", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });

      const res = await request(app)
        .post(ORDERS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ shippingAddress: validAddressPayload({ latitude: 12.9716, longitude: 77.5946 }) });

      expect(res.status).toBe(201);
      expect(res.body.data.shippingAddress.latitude).toBeCloseTo(12.9716, 4);
      expect(res.body.data.shippingAddress.longitude).toBeCloseTo(77.5946, 4);
    });

    it("does NOT create a saved Address row from an inline Order shipping address", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });

      await request(app)
        .post(ORDERS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ shippingAddress: validAddressPayload() });

      const addresses = await request(app).get(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(addresses.body.data).toHaveLength(0);
    });

    it("rejects both savedAddressId and shippingAddress supplied together", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });

      const res = await request(app)
        .post(ORDERS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: addressId, shippingAddress: validAddressPayload() });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUTH_VALIDATION_FAILED");
    });
  });

  // ---------------------------------------------------------------------
  // Checkout Preview <-> Order Creation parity: any shipping-address source
  // Checkout Preview accepts must also be consumable by Order Creation.
  // ---------------------------------------------------------------------
  describe("Checkout Preview <-> Order Creation Parity", () => {
    it("guest inline address: identical body accepted by both Checkout Preview and Order Creation", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = request.agent(app);
      await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
      const body = { shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" };

      const preview = await guest.post(CHECKOUT_URL).send(body);
      const order = await guest.post(ORDERS_URL).send(body);

      expect(preview.status).toBe(200);
      expect(order.status).toBe(201);
    });

    it("customer savedAddressId: identical body accepted by both Checkout Preview and Order Creation", async () => {
      const { addressId } = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const body = { savedAddressId: addressId };

      const preview = await request(app).post(CHECKOUT_URL).set("Authorization", `Bearer ${customerAToken}`).send(body);
      const order = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send(body);

      expect(preview.status).toBe(200);
      expect(order.status).toBe(201);
    });

    it("customer inline address: identical body accepted by both Checkout Preview and Order Creation", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const body = { shippingAddress: validAddressPayload() };

      const preview = await request(app).post(CHECKOUT_URL).set("Authorization", `Bearer ${customerAToken}`).send(body);
      const order = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send(body);

      expect(preview.status).toBe(200);
      expect(order.status).toBe(201);
    });
  });

  // ---------------------------------------------------------------------
  // Admin: guest Order safety
  // ---------------------------------------------------------------------
  describe("Admin Guest Order Safety", () => {
    async function createGuestOrder(): Promise<{ id: number }> {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = request.agent(app);
      await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
      const res = await guest.post(ORDERS_URL).send({ shippingAddress: validAddressPayload(), contactEmail: "guest@example.com" });
      return { id: res.body.data.id as number };
    }

    it("lists a guest Order with customer: null instead of crashing or fabricating a customer", async () => {
      await createGuestOrder();

      const res = await request(app).get(ADMIN_ORDERS_URL).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      const guestRow = res.body.data.items.find((item: { customer: unknown }) => item.customer === null);
      expect(guestRow).toBeDefined();
    });

    it("returns a guest Order's detail with customer: null and the shipping snapshot intact", async () => {
      const { id } = await createGuestOrder();

      const res = await request(app).get(`${ADMIN_ORDERS_URL}/${id}`).set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.customer).toBeNull();
      expect(res.body.data.shippingAddress.recipientName).toBe("Jordan Rivera");
    });

    it("blocks an Admin from moving an unpaid guest Order into fulfilment", async () => {
      const { id } = await createGuestOrder();

      const res = await request(app).patch(`${ADMIN_ORDERS_URL}/${id}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "confirmed" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_PAYMENT_REQUIRED_FOR_FULFILMENT");
    });
  });

  // ---------------------------------------------------------------------
  // Customer Orders List — product previews, shipment summary, filters
  // ---------------------------------------------------------------------
  describe("Customer Orders List", () => {
    async function createShipmentForOrder(orderId: number, overrides: Partial<{ status: string; carrier: string | null; trackingNumber: string | null }> = {}): Promise<void> {
      await sequelize.transaction(async (t) => {
        const id = await IdSequenceService.allocateNextId("shipments", t);
        await Shipment.create(
          {
            id, shipment_number: buildBusinessReference("shipment", id), source_type: "order", source_id: orderId, order_id: orderId,
            replacement_id: null, method: "standard", provider: "ithink", provider_order_id: `REF-${id}`,
            provider_shipment_id: null, carrier: overrides.carrier === undefined ? "Courier A" : overrides.carrier,
            tracking_number: overrides.trackingNumber === undefined ? `AWB-${id}` : overrides.trackingNumber,
            service_type: "Surface", status: (overrides.status ?? "awb_assigned") as never, provider_status: "Created internally", provider_status_code: "INTERNAL_TEST_CODE",
            pickup_warehouse_id: "warehouse-1", weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00",
            shipping_charge: "87.50", currency: "INR", shipped_at: null, delivered_at: null, cancelled_at: null, rto_at: null,
            last_synced_at: new Date(), raw_payload: null
          } as never,
          { transaction: t }
        );
      });
    }

    it("returns up to 3 product previews with name and image, without full item objects", async () => {
      const p1 = await createSimpleProduct({ stock: 10 });
      const p2 = await createSimpleProduct({ stock: 10 });
      const p3 = await createSimpleProduct({ stock: 10 });
      const p4 = await createSimpleProduct({ stock: 10 });
      const token = customerAToken;
      for (const p of [p1, p2, p3, p4]) {
        await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${token}`).send({ productId: p.id, quantity: 1 });
      }
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${token}`).send(validAddressPayload());
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${token}`).send({ savedAddressId: address.body.data.id });

      const res = await request(app).get(ORDERS_URL).set("Authorization", `Bearer ${token}`);
      expect(res.status).toBe(200);
      const order = res.body.data.items[0];
      expect(order.products).toHaveLength(3);
      expect(order.products[0]).toEqual({ name: p1.name, image: null });
      expect(order.items).toBeUndefined();
    });

    it("handles a product with no image by returning image: null rather than omitting the field", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const a = await addSimpleItemAndCreateAddress(customerAToken);
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });

      const res = await request(app).get(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      const order = res.body.data.items[0];
      expect(order.products.every((p: { image: string | null }) => p.image === null)).toBe(true);
    });

    it("returns a customer-safe shipment summary when a shipment exists", async () => {
      const paid = await createPaidOrder(customerAToken);
      await createShipmentForOrder(paid.orderId, { status: "in_transit", carrier: "Courier A" });

      const res = await request(app).get(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      const order = res.body.data.items.find((item: { id: number }) => item.id === paid.orderId);
      expect(order.shipment).toEqual({ status: "in_transit", carrier: "Courier A", trackingAvailable: true });
    });

    it("returns shipment: null when the order has no shipment yet", async () => {
      const paid = await createPaidOrder(customerAToken);

      const res = await request(app).get(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      const order = res.body.data.items.find((item: { id: number }) => item.id === paid.orderId);
      expect(order.shipment).toBeNull();
    });

    it("never exposes provider_status, provider_status_code, or failureReason on the listing shipment summary", async () => {
      const paid = await createPaidOrder(customerAToken);
      await createShipmentForOrder(paid.orderId, { status: "in_transit" });

      const res = await request(app).get(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`);
      const order = res.body.data.items.find((item: { id: number }) => item.id === paid.orderId);
      expect(Object.keys(order.shipment).sort()).toEqual(["carrier", "status", "trackingAvailable"]);
      expect(JSON.stringify(order.shipment)).not.toContain("INTERNAL_TEST_CODE");
    });

    it("filters by order status", async () => {
      const paid = await createPaidOrder(customerAToken);
      const a = await addSimpleItemAndCreateAddress(customerAToken);
      const pendingRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });
      const pendingId = pendingRes.body.data.id;

      const res = await request(app).get(ORDERS_URL).query({ status: "confirmed" }).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      const ids = res.body.data.items.map((item: { id: number }) => item.id);
      expect(ids).toContain(paid.orderId);
      expect(ids).not.toContain(pendingId);
    });

    it("filters by placed-date range", async () => {
      const paid = await createPaidOrder(customerAToken);

      const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const resExcluded = await request(app).get(ORDERS_URL).query({ from: future }).set("Authorization", `Bearer ${customerAToken}`);
      expect(resExcluded.body.data.items.map((item: { id: number }) => item.id)).not.toContain(paid.orderId);

      const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const resIncluded = await request(app).get(ORDERS_URL).query({ from: past }).set("Authorization", `Bearer ${customerAToken}`);
      expect(resIncluded.body.data.items.map((item: { id: number }) => item.id)).toContain(paid.orderId);
    });

    it("searches by order number only", async () => {
      const paid = await createPaidOrder(customerAToken);
      const orderNumber: string = (await request(app).get(`${ORDERS_URL}/${paid.orderId}`).set("Authorization", `Bearer ${customerAToken}`)).body.data.orderNumber;

      const res = await request(app).get(ORDERS_URL).query({ search: orderNumber }).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items.map((item: { id: number }) => item.id)).toContain(paid.orderId);

      const missRes = await request(app).get(ORDERS_URL).query({ search: "NO-SUCH-ORDER-NUMBER" }).set("Authorization", `Bearer ${customerAToken}`);
      expect(missRes.body.data.items).toHaveLength(0);
    });

    it("rejects an invalid status filter value", async () => {
      const res = await request(app).get(ORDERS_URL).query({ status: "not_a_real_status" }).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(400);
    });

    it("still returns unchanged existing fields alongside the new ones (backward compatibility)", async () => {
      const paid = await createPaidOrder(customerAToken);

      const res = await request(app).get(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`);
      const order = res.body.data.items.find((item: { id: number }) => item.id === paid.orderId);
      expect(order.orderNumber).toEqual(expect.any(String));
      expect(order.status).toBe("confirmed");
      expect(order.paymentStatus).toBe("paid");
      expect(order.itemCount).toBe(1);
      expect(order.total).toBeDefined();
      expect(order.placedAt).toEqual(expect.any(String));
    });
  });

  // ---------------------------------------------------------------------
  // Customer Order Detail — payment info & refund summary
  // ---------------------------------------------------------------------
  describe("Customer Order Payment & Refund Summary", () => {
    it("returns payment provider/method/status/providerOrderId/paidAt for a paid Order", async () => {
      const paid = await createPaidOrder(customerAToken);

      const res = await request(app).get(`${ORDERS_URL}/${paid.orderId}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.payments).toHaveLength(1);
      const payment = res.body.data.payments[0];
      expect(payment.provider).toBe("payu");
      expect(payment.status).toBe("paid");
      expect(payment.providerOrderId).toEqual(expect.any(String));
      expect(payment.paidAt).toEqual(expect.any(String));
    });

    it("returns every payment attempt on the Order, including an earlier failed attempt", async () => {
      const a = await addSimpleItemAndCreateAddress(customerAToken, { stock: 10 });
      const orderRes = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: a.addressId });
      const orderId = orderRes.body.data.id;

      const initRes1 = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      const fields1 = initRes1.body.data.fields;
      const hash1 = buildPayuResponseHash(
        { key: fields1.key, txnid: fields1.txnid, amount: fields1.amount, productinfo: fields1.productinfo, firstname: fields1.firstname, email: fields1.email, udf1: fields1.udf1, status: "failure" },
        paymentConfig.payuSalt as string
      );
      await request(app)
        .post(WEBHOOK_URL)
        .type("form")
        .send({ status: "failure", txnid: fields1.txnid, amount: fields1.amount, productinfo: fields1.productinfo, firstname: fields1.firstname, email: fields1.email, udf1: fields1.udf1, mihpayid: `mihpay_fail_${fields1.txnid}`, mode: "UPI", hash: hash1 });

      const initRes2 = await request(app).post(INITIATE_URL).set("Authorization", `Bearer ${customerAToken}`).send({ orderId });
      const fields2 = initRes2.body.data.fields;
      const hash2 = buildPayuResponseHash(
        { key: fields2.key, txnid: fields2.txnid, amount: fields2.amount, productinfo: fields2.productinfo, firstname: fields2.firstname, email: fields2.email, udf1: fields2.udf1, status: "success" },
        paymentConfig.payuSalt as string
      );
      await request(app)
        .post(WEBHOOK_URL)
        .type("form")
        .send({ status: "success", txnid: fields2.txnid, amount: fields2.amount, productinfo: fields2.productinfo, firstname: fields2.firstname, email: fields2.email, udf1: fields2.udf1, mihpayid: `mihpay_ok_${fields2.txnid}`, mode: "UPI", hash: hash2 });

      const res = await request(app).get(`${ORDERS_URL}/${orderId}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.payments).toHaveLength(2);
      const statuses = res.body.data.payments.map((p: { status: string }) => p.status).sort();
      expect(statuses).toEqual(["failed", "paid"]);
    });

    it("never exposes admin-only Payment fields (id, providerPaymentId, amount, currency, createdAt, failedAt) on the customer response", async () => {
      const paid = await createPaidOrder(customerAToken);

      const res = await request(app).get(`${ORDERS_URL}/${paid.orderId}`).set("Authorization", `Bearer ${customerAToken}`);
      const payment = res.body.data.payments[0];
      expect(Object.keys(payment).sort()).toEqual(["method", "paidAt", "providerOrderId", "provider", "refundedAt", "status"].sort());
    });

    it("returns refundSummary: null when the Order has no Refund at all", async () => {
      const paid = await createPaidOrder(customerAToken);

      const res = await request(app).get(`${ORDERS_URL}/${paid.orderId}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.refundSummary).toBeNull();
    });

    it("includes a cancellation-triggered refund (no Return involved) in refundSummary", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: 1, request_id: "req_cancel_summary" })));

      const paid = await createPaidOrder(customerAToken, { price: "500.00", quantity: 2 });
      const cancelRes = await request(app).patch(`${ADMIN_ORDERS_URL}/${paid.orderId}/status`).set("Authorization", `Bearer ${superAdminToken}`).send({ status: "cancelled" });
      expect(cancelRes.status).toBe(200);

      const res = await request(app).get(`${ORDERS_URL}/${paid.orderId}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.refundSummary).not.toBeNull();
      expect(res.body.data.refundSummary.status).toBe("processing");
      // Not yet succeeded (no PayU confirmation processed) — no money counted as moved yet.
      expect(res.body.data.refundSummary.totalRefunded).toBe("0.00");

      vi.unstubAllGlobals();
    });
  });
});
