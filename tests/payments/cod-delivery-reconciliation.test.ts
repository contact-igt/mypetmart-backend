/* eslint-disable */
import { Op } from "sequelize";
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

import { IThinkClient } from "../../src/models/ShipmentModels/ithink.client.js";
import { ShipmentService } from "../../src/models/ShipmentModels/shipment.service.js";
import { PaymentService } from "../../src/models/PaymentModels/payment.service.js";
import { AdminOrderService } from "../../src/models/OrderModels/order.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { Category, Order, OrderItem, Payment, Product, Shipment, ShipmentTrackingEvent } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";

// Phase E.2 — COD delivery -> payment reconciliation. Covers the fix for the
// bug audited earlier: a COD Order reaching "delivered" (via automatic
// courier tracking OR a manual admin status update) previously left
// Payment.status / Order.payment_status stuck "pending" forever. These tests
// exercise PaymentService.markCodDelivered() through both real integration
// points (ShipmentService.applyFulfilment, AdminOrderService.updateStatus),
// plus a direct idempotency check on the helper itself.
describe("COD delivery payment reconciliation (Phase E.2)", () => {
  const baseId = 996_000;
  let counter = 0;
  const createdCategoryIds: number[] = [];
  const createdOrderIds: number[] = [];

  async function clean(): Promise<void> {
    if (createdOrderIds.length === 0 && createdCategoryIds.length === 0) return;
    const shipmentIds = (await Shipment.findAll({ where: { order_id: { [Op.in]: createdOrderIds } }, attributes: ["id"] })).map((s) => s.id);
    await ShipmentTrackingEvent.destroy({ where: { shipment_id: { [Op.in]: shipmentIds } }, force: true });
    await Shipment.destroy({ where: { order_id: { [Op.in]: createdOrderIds } }, force: true });
    await Payment.destroy({ where: { order_id: { [Op.in]: createdOrderIds } }, force: true });
    await OrderItem.destroy({ where: { order_id: { [Op.in]: createdOrderIds } }, force: true });
    await Order.destroy({ where: { id: { [Op.in]: createdOrderIds } }, force: true });
    if (createdCategoryIds.length > 0) {
      await Product.destroy({ where: { category_id: { [Op.in]: createdCategoryIds } }, force: true });
      await Category.destroy({ where: { id: { [Op.in]: createdCategoryIds } }, force: true });
    }
    createdCategoryIds.length = 0;
    createdOrderIds.length = 0;
  }

  // paymentStatus defaults to "pending" (the real state a COD-confirmed Order
  // is left in — see PaymentService.confirmCodOrder) so every COD fixture in
  // this file matches production shape; PayU-style fixtures pass "paid".
  async function createOrder(paymentStatus: "pending" | "paid" = "pending"): Promise<{ order: Order }> {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const category = await Category.create({ id: baseId + counter * 20, name: `CodRecon ${suffix}`, slug: `cod-recon-${suffix}`, description: "COD reconciliation test", pet_type: "all", active: true, display_order: 1 });
    createdCategoryIds.push(category.id);
    const product = await Product.create({
      id: category.id + 1, category_id: category.id, name: `CodRecon Product ${suffix}`, slug: `cod-recon-product-${suffix}`, sku: `CODRECON-${suffix}`,
      description: "COD reconciliation test", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 20, has_variants: false, featured: false,
      tags: null, meta_title: null, meta_description: null, weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00"
    } as never);
    const order = await Order.create({
      id: category.id + 2, order_number: `ORD-${suffix}`, user_id: null, guest_identity_hash: null, guest_access_token_hash: null, cart_id: null,
      contact_email: "cod-recon@example.com", status: "confirmed", payment_status: paymentStatus, fulfilment_status: "unfulfilled", commerce_exception: null,
      subtotal: "1000.00", shipping_fee: "0.00", total: "1000.00", currency: "INR",
      ship_recipient_name: "Cod Recon Customer", ship_phone: "+91 98765 43210", ship_line_1: "10 Test Street", ship_line_2: null,
      ship_city: "Mumbai", ship_state: "Maharashtra", ship_postal_code: "400001", ship_country: "IN", ship_latitude: null, ship_longitude: null,
      placed_at: new Date("2026-08-18T08:00:00.000Z"), cancelled_at: null
    });
    createdOrderIds.push(order.id);
    await OrderItem.create({ id: category.id + 3, order_id: order.id, product_id: product.id, product_variant_id: null, product_name: product.name, product_sku: product.sku, variant_name: null, variant_sku: null, product_image: null, quantity: 1, unit_price: "500.00", line_total: "500.00" });
    return { order };
  }

  // Mirrors the real shape PaymentService.confirmCodOrder leaves behind: a
  // durable, permanently-"pending"-until-now Payment row, provider "cod".
  async function createCodPayment(order: Order): Promise<Payment> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId("payments", t);
      return Payment.create(
        { id, order_id: order.id, amount: order.total, currency: order.currency, provider: "cod", status: "pending", provider_order_id: null, provider_payment_id: null, method: "cod", raw_payload: null },
        { transaction: t }
      );
    });
  }

  async function createShipment(order: Order, overrides: Partial<{ status: string }> = {}): Promise<Shipment> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId("shipments", t);
      return Shipment.create(
        {
          id, shipment_number: buildBusinessReference("shipment", id), source_type: "order", source_id: order.id, order_id: order.id,
          replacement_id: null, method: "standard", provider: "ithink", provider_order_id: `REF-${id}`,
          provider_shipment_id: null, carrier: "Courier A", tracking_number: `AWB-${id}`,
          service_type: "Surface", status: (overrides.status ?? "out_for_delivery") as never, provider_status: "Out for Delivery", provider_status_code: null,
          pickup_warehouse_id: "warehouse-1", weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00",
          shipping_charge: "87.50", currency: "INR", shipped_at: new Date("2026-08-19T08:00:00.000Z"), delivered_at: null, cancelled_at: null, rto_at: null,
          last_synced_at: null, raw_payload: null
        },
        { transaction: t }
      );
    });
  }

  function mockTracking(status: string) {
    return vi.spyOn(IThinkClient, "track").mockResolvedValue({
      awb: "AWB-TRACKED", courier: "Courier A", currentStatus: status, currentStatusCode: null,
      events: [{ status, statusCode: null, location: "Mumbai Hub", message: null, eventAt: "2026-08-20 09:00:00" }]
    });
  }

  const admin = { id: 1, role: "admin" as const };

  beforeAll(async () => { await connectDatabase(); });
  beforeEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await disconnectDatabase(); });

  it("COD shipment delivery updates payment", async () => {
    const { order } = await createOrder("pending");
    const payment = await createCodPayment(order);
    const shipment = await createShipment(order, { status: "out_for_delivery" });
    mockTracking("Delivered");

    await ShipmentService.refresh(shipment.id);

    const refreshedOrder = await Order.findByPk(order.id);
    const refreshedPayment = await Payment.findByPk(payment.id);
    const refreshedShipment = await Shipment.findByPk(shipment.id);

    expect(refreshedOrder?.status).toBe("delivered");
    expect(refreshedOrder?.payment_status).toBe("paid");
    expect(refreshedPayment?.status).toBe("paid");
    expect(refreshedPayment?.paid_at?.toISOString()).toBe(refreshedShipment?.delivered_at?.toISOString());
  });

  it("PayU delivery does not modify payment", async () => {
    const { order } = await createOrder("paid"); // already paid upfront by PayU, no COD Payment row exists
    const shipment = await createShipment(order, { status: "out_for_delivery" });
    mockTracking("Delivered");

    await ShipmentService.refresh(shipment.id);

    const refreshedOrder = await Order.findByPk(order.id);
    expect(refreshedOrder?.status).toBe("delivered");
    expect(refreshedOrder?.payment_status).toBe("paid"); // unchanged — was already "paid" before delivery
    const payments = await Payment.findAll({ where: { order_id: order.id } });
    expect(payments).toHaveLength(0); // markCodDelivered found no COD Payment and safely no-op'd
  });

  it("admin manual delivery updates COD payment", async () => {
    const { order } = await createOrder("pending");
    const payment = await createCodPayment(order);

    await AdminOrderService.updateStatus(order.id, "delivered", admin);

    const refreshedOrder = await Order.findByPk(order.id);
    const refreshedPayment = await Payment.findByPk(payment.id);
    expect(refreshedOrder?.status).toBe("delivered");
    expect(refreshedOrder?.payment_status).toBe("paid");
    expect(refreshedPayment?.status).toBe("paid");
    expect(refreshedPayment?.paid_at).not.toBeNull();
  });

  it("duplicate delivery sync is idempotent", async () => {
    const { order } = await createOrder("pending");
    const payment = await createCodPayment(order);

    const firstDeliveredAt = new Date("2026-08-20T10:00:00.000Z");
    await sequelize.transaction(async (t) => {
      const locked = await Order.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
      await PaymentService.markCodDelivered(locked!, firstDeliveredAt, t);
      await locked!.save({ transaction: t });
    });

    const afterFirst = await Payment.findByPk(payment.id);
    expect(afterFirst?.status).toBe("paid");
    expect(afterFirst?.paid_at?.toISOString()).toBe(firstDeliveredAt.toISOString());

    // A second reconciliation attempt (e.g. a re-ingested duplicate courier
    // event, or an admin re-running the manual delivery action) must be a
    // true no-op — it must NOT overwrite paid_at with this later timestamp.
    const secondDeliveredAt = new Date("2026-08-21T10:00:00.000Z");
    await sequelize.transaction(async (t) => {
      const locked = await Order.findByPk(order.id, { transaction: t, lock: t.LOCK.UPDATE });
      await PaymentService.markCodDelivered(locked!, secondDeliveredAt, t);
      await locked!.save({ transaction: t });
    });

    const afterSecond = await Payment.findByPk(payment.id);
    expect(afterSecond?.status).toBe("paid");
    expect(afterSecond?.paid_at?.toISOString()).toBe(firstDeliveredAt.toISOString());
    const refreshedOrder = await Order.findByPk(order.id);
    expect(refreshedOrder?.payment_status).toBe("paid");
  });
});
