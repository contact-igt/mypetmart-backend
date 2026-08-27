/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockedShippingConfig = vi.hoisted(() => ({
  provider: "ithink",
  accessToken: "test-access-token",
  secretKey: "test-secret-key",
  apiBaseUrl: "https://pre-alpha.ithinklogistics.com",
  trackingBaseUrl: "https://pre-alpha.ithinklogistics.com",
  storeId: "27377",
  pickupAddressId: "warehouse-1",
  returnAddressId: "returns-1",
  originPincode: "600001",
  timeoutMs: 1_000,
  ready: true
}));

vi.mock("../../src/config/shipping.config.js", () => ({
  shippingConfig: mockedShippingConfig
}));

import { app } from "../../src/app.js";
import { IThinkClient, IThinkClientError } from "../../src/models/ShipmentModels/ithink.client.js";
import { ShipmentService } from "../../src/models/ShipmentModels/shipment.service.js";
import { Address } from "../../src/database/tables/AddressTable/index.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductReview } from "../../src/database/tables/ProductReviewTable/index.js";
import { Cart } from "../../src/database/tables/CartTable/index.js";
import { CartItem } from "../../src/database/tables/CartItemTable/index.js";
import { Order } from "../../src/database/tables/OrderTable/index.js";
import { OrderItem } from "../../src/database/tables/OrderItemTable/index.js";
import { Payment } from "../../src/database/tables/PaymentTable/index.js";
import { Shipment } from "../../src/database/tables/ShipmentTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const ORDERS_URL = "/api/v1/storefront/orders";
const ADMIN_ORDERS_URL = "/api/v1/admin/orders";

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      { id, name: "Shipping Address Test Category", slug: `ship-addr-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, description: "Category for shipping address tests", pet_type: "all", active: true, display_order: 1 },
      { transaction: t }
    );
  });
  return category.id;
}

async function createSimpleProduct(): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id, category_id: categoryId, name: `Shipping Address Test Product ${skuCounter}`, slug: `ship-addr-product-${skuCounter}-${Date.now()}`,
        sku: `SHIPADDR-${skuCounter}-${Date.now()}`, description: "Simple product", pet_type: "all", status: "active", price: "499.00",
        compare_at_price: null, stock: 50, has_variants: false, featured: false, weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00"
      } as never,
      { transaction: t }
    );
  });
}

function validAddressPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return { recipientName: "Jordan Rivera", phone: "+91 98765 43210", line1: "221B Baker Street", city: "Mumbai", state: "Maharashtra", postalCode: "400001", ...overrides };
}

async function mintCustomerToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const user = await User.create({ id, name: `Shipping Address Customer ${id}`, email, password_hash: pwdHash, role: "customer", status: "active", reference_code: `CUS-${id}` });
  const { session } = await SessionService.createSession(user.id, "customer", null, null);
  return TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role: "customer", sessionType: "customer" });
}

async function mintAdminToken(id: number, email: string, role: "admin" | "super_admin" = "admin"): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const admin = await User.create({ id, name: `Shipping Address Admin ${id}`, email, password_hash: pwdHash, role, status: "active", reference_code: `ADM-${id}` });
  const { session } = await SessionService.createSession(admin.id, "admin", null, null);
  return TokenService.generateAccessToken({ sub: String(admin.id), sessionId: String(session.id), role, sessionType: "admin" });
}

describe("Admin Order Shipping Address Update", () => {
  let customerToken: string;
  let adminToken: string;
  const CUSTOMER_ID = 99901;
  const ADMIN_ID = 99902;

  beforeAll(async () => {
    await connectDatabase();
    for (const id of [CUSTOMER_ID, ADMIN_ID]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }
    customerToken = await mintCustomerToken(CUSTOMER_ID, "shipaddr-customer@example.com");
    adminToken = await mintAdminToken(ADMIN_ID, "shipaddr-admin@example.com");
  });

  afterAll(async () => {
    await Shipment.destroy({ where: {}, truncate: false, force: true });
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    // Scoped to this file's own Category (not a blanket `where: {}`) — under
    // full-suite parallel execution, a blanket Product delete can hit
    // another concurrently-running test file's in-flight Product and trip a
    // FK constraint on its child rows (observed with product_faqs); see the
    // matching fix/comment in tests/shipments/shipment-reliability.test.ts.
    if (categoryId) {
      await Product.destroy({ where: { category_id: categoryId }, truncate: false, force: true });
      await Category.destroy({ where: { id: categoryId }, truncate: false, force: true });
    }
    await AuthSession.destroy({ where: { user_id: [CUSTOMER_ID, ADMIN_ID] }, force: true });
    await User.destroy({ where: { id: [CUSTOMER_ID, ADMIN_ID] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await Shipment.destroy({ where: {}, truncate: false, force: true });
    await Payment.destroy({ where: {}, truncate: false, force: true });
    await ProductReview.destroy({ where: {}, truncate: false, force: true });
    await OrderItem.destroy({ where: {}, truncate: false, force: true });
    await Order.destroy({ where: {}, truncate: false, force: true });
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    if (categoryId) {
      await Product.destroy({ where: { category_id: categoryId }, truncate: false, force: true });
      await Category.destroy({ where: { id: categoryId }, truncate: false, force: true });
    }
    categoryId = await createCategory();
  });

  async function createOrderWithSavedAddress(): Promise<{ orderId: number; addressId: number }> {
    const product = await createSimpleProduct();
    await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerToken}`).send({ productId: product.id, quantity: 1 });
    const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerToken}`).send(validAddressPayload());
    const order = await request(app).post(ORDERS_URL).set("Authorization", `Bearer ${customerToken}`).send({ savedAddressId: address.body.data.id });
    return { orderId: order.body.data.id, addressId: address.body.data.id };
  }

  // -------------------------------------------------------------------
  describe("Admin can update shipping address", () => {
    it("updates the Order's own shipping snapshot", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recipientName: "Alex Corrected", phone: "9876500000", line1: "12 ABC Street", line2: "", city: "Chennai", state: "Tamil Nadu", postalCode: "600077" });

      expect(res.status).toBe(200);
      expect(res.body.data.shippingAddress).toMatchObject({ recipientName: "Alex Corrected", line1: "12 ABC Street", city: "Chennai", state: "Tamil Nadu", postalCode: "600077" });

      const order = await Order.findByPk(orderId);
      expect(order?.ship_recipient_name).toBe("Alex Corrected");
      expect(order?.ship_city).toBe("Chennai");
      expect(order?.ship_postal_code).toBe("600077");
      expect(order?.ship_latitude).toBeNull();
      expect(order?.ship_longitude).toBeNull();
    });

    it("allows a super_admin to update as well", async () => {
      const superAdminToken = await mintAdminToken(99903, "shipaddr-super@example.com", "super_admin");
      const { orderId } = await createOrderWithSavedAddress();
      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${superAdminToken}`)
        .send({ recipientName: "Super Edited", phone: "9876500000", line1: "1 Test Rd", city: "Pune", state: "Maharashtra", postalCode: "411001" });
      expect(res.status).toBe(200);
      await AuthSession.destroy({ where: { user_id: 99903 }, force: true });
      await User.destroy({ where: { id: 99903 }, force: true });
    });
  });

  // -------------------------------------------------------------------
  describe("Security", () => {
    it("blocks a customer from updating the shipping address", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ recipientName: "Hacker", phone: "9876500000", line1: "1 Evil St", city: "Chennai", state: "Tamil Nadu", postalCode: "600077" });
      expect(res.status).toBe(401);
    });

    it("blocks an unauthenticated request", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .send({ recipientName: "Nobody", phone: "9876500000", line1: "1 St", city: "Chennai", state: "Tamil Nadu", postalCode: "600077" });
      expect(res.status).toBe(401);
    });
  });

  // -------------------------------------------------------------------
  describe("Validation", () => {
    it("rejects a missing recipient name", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recipientName: "", phone: "9876500000", line1: "1 St", city: "Chennai", state: "Tamil Nadu", postalCode: "600077" });
      expect(res.status).toBe(400);
    });

    it("rejects an invalid phone number", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recipientName: "Alex", phone: "12345", line1: "1 St", city: "Chennai", state: "Tamil Nadu", postalCode: "600077" });
      expect(res.status).toBe(400);
    });

    it("rejects an invalid pincode format", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recipientName: "Alex", phone: "9876500000", line1: "1 St", city: "Chennai", state: "Tamil Nadu", postalCode: "ABCDEF" });
      expect(res.status).toBe(400);
    });

    it("rejects a missing city/state/line1", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recipientName: "Alex", phone: "9876500000", line1: "", city: "", state: "", postalCode: "600077" });
      expect(res.status).toBe(400);
    });

    it("blocks editing the address once the order is cancelled", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      await request(app).patch(`${ADMIN_ORDERS_URL}/${orderId}/status`).set("Authorization", `Bearer ${adminToken}`).send({ status: "cancelled" });
      const res = await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recipientName: "Alex", phone: "9876500000", line1: "1 St", city: "Chennai", state: "Tamil Nadu", postalCode: "600077" });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("ORDER_SHIPPING_ADDRESS_NOT_EDITABLE");
    });
  });

  // -------------------------------------------------------------------
  describe("Customer profile address unchanged", () => {
    it("never modifies the customer's saved Address book entry", async () => {
      const { orderId, addressId } = await createOrderWithSavedAddress();
      await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recipientName: "Order-Only Edit", phone: "9876500000", line1: "Different Street", city: "Chennai", state: "Tamil Nadu", postalCode: "600077" });

      const savedAddress = await Address.findByPk(addressId);
      expect(savedAddress?.recipient_name).toBe("Jordan Rivera");
      expect(savedAddress?.line_1).toBe("221B Baker Street");
      expect(savedAddress?.city).toBe("Mumbai");
      expect(savedAddress?.postal_code).toBe("400001");
    });
  });

  // -------------------------------------------------------------------
  // Shipment retry integration — the corrected address must be what a
  // subsequent retry sends to iThink, with zero separate retry wiring.
  // -------------------------------------------------------------------
  describe("Shipment retry uses the corrected address", () => {
    it("retry sends the updated recipient/pincode, not the original", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      await Order.update({ payment_status: "paid", status: "confirmed" }, { where: { id: orderId } });

      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      const createSpy = vi.spyOn(IThinkClient, "createShipment")
        .mockRejectedValueOnce(new IThinkClientError("CREATE_REJECTED", "No shipping services available for recipient address"));
      await expect(ShipmentService.createForOrder(orderId)).rejects.toBeDefined();

      const failed = await Shipment.findOne({ where: { order_id: orderId } });
      expect(failed?.status).toBe("failed");

      await request(app)
        .patch(`${ADMIN_ORDERS_URL}/${orderId}/shipping-address`)
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ recipientName: "Corrected Recipient", phone: "9876500000", line1: "Corrected Street", city: "Chennai", state: "Tamil Nadu", postalCode: "600077" });

      createSpy.mockResolvedValueOnce({ awb: "AWB-CORRECTED", reference: "REF-CORRECTED", courier: "Courier A", trackingUrl: null });
      const retried = await ShipmentService.retry(failed!.id);

      expect(retried.status).toBe("awb_assigned");
      expect(createSpy).toHaveBeenLastCalledWith(
        expect.objectContaining({
          recipient: expect.objectContaining({ name: "Corrected Recipient", address1: "Corrected Street", pincode: "600077", city: "Chennai" })
        })
      );
    });

    it("existing shipment retry still works for an order whose address was never edited", async () => {
      const { orderId } = await createOrderWithSavedAddress();
      await Order.update({ payment_status: "paid", status: "confirmed" }, { where: { id: orderId } });

      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      const createSpy = vi.spyOn(IThinkClient, "createShipment")
        .mockRejectedValueOnce(new IThinkClientError("CREATE_REJECTED", "timeout"))
        .mockResolvedValueOnce({ awb: "AWB-UNCHANGED", reference: "REF-UNCHANGED", courier: "Courier A", trackingUrl: null });
      await expect(ShipmentService.createForOrder(orderId)).rejects.toBeDefined();

      const failed = await Shipment.findOne({ where: { order_id: orderId } });
      const retried = await ShipmentService.retry(failed!.id);
      expect(retried.status).toBe("awb_assigned");
      expect(createSpy).toHaveBeenLastCalledWith(expect.objectContaining({ recipient: expect.objectContaining({ name: "Jordan Rivera", pincode: "400001" }) }));
    });
  });
});
