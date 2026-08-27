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
import { emailService } from "../../src/services/email/email.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { Category, NotificationLog, Order, OrderItem, Product, Shipment, ShipmentTrackingEvent } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";

describe("Shipment notifications (Phase 1D.2)", () => {
  const baseId = 994_000;
  let counter = 0;
  const createdCategoryIds: number[] = [];
  const createdOrderIds: number[] = [];

  async function clean(): Promise<void> {
    if (createdOrderIds.length === 0 && createdCategoryIds.length === 0) return;
    await NotificationLog.destroy({ where: { entity_type: "shipment", entity_id: { [Op.in]: (await Shipment.findAll({ where: { order_id: { [Op.in]: createdOrderIds } }, attributes: ["id"] })).map((s) => s.id) } }, force: true });
    await NotificationLog.destroy({ where: { entity_type: "order", entity_id: { [Op.in]: createdOrderIds } }, force: true });
    await ShipmentTrackingEvent.destroy({ where: { shipment_id: { [Op.in]: (await Shipment.findAll({ where: { order_id: { [Op.in]: createdOrderIds } }, attributes: ["id"] })).map((s) => s.id) } }, force: true });
    await Shipment.destroy({ where: { order_id: { [Op.in]: createdOrderIds } }, force: true });
    await OrderItem.destroy({ where: { order_id: { [Op.in]: createdOrderIds } }, force: true });
    await Order.destroy({ where: { id: { [Op.in]: createdOrderIds } }, force: true });
    if (createdCategoryIds.length > 0) {
      await Product.destroy({ where: { category_id: { [Op.in]: createdCategoryIds } }, force: true });
      await Category.destroy({ where: { id: { [Op.in]: createdCategoryIds } }, force: true });
    }
    createdCategoryIds.length = 0;
    createdOrderIds.length = 0;
  }

  async function createOrder(): Promise<{ order: Order }> {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const category = await Category.create({ id: baseId + counter * 20, name: `Notif ${suffix}`, slug: `notif-${suffix}`, description: "Notification test", pet_type: "all", active: true, display_order: 1 });
    createdCategoryIds.push(category.id);
    const product = await Product.create({
      id: category.id + 1, category_id: category.id, name: `Notif Product ${suffix}`, slug: `notif-product-${suffix}`, sku: `NOTIF-${suffix}`,
      description: "Notification test", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 20, has_variants: false, featured: false,
      tags: null, meta_title: null, meta_description: null, weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00"
    } as never);
    const order = await Order.create({
      id: category.id + 2, order_number: `ORD-${suffix}`, user_id: null, guest_identity_hash: null, guest_access_token_hash: null, cart_id: null,
      contact_email: "notif@example.com", status: "confirmed", payment_status: "paid", fulfilment_status: "unfulfilled", commerce_exception: null,
      subtotal: "1000.00", shipping_fee: "0.00", total: "1000.00", currency: "INR",
      ship_recipient_name: "Notif Customer", ship_phone: "+91 98765 43210", ship_line_1: "10 Test Street", ship_line_2: null,
      ship_city: "Mumbai", ship_state: "Maharashtra", ship_postal_code: "400001", ship_country: "IN", ship_latitude: null, ship_longitude: null,
      placed_at: new Date("2026-08-18T08:00:00.000Z"), cancelled_at: null
    });
    createdOrderIds.push(order.id);
    await OrderItem.create({ id: category.id + 3, order_id: order.id, product_id: product.id, product_variant_id: null, product_name: product.name, product_sku: product.sku, variant_name: null, variant_sku: null, product_image: null, quantity: 1, unit_price: "500.00", line_total: "500.00" });
    return { order };
  }

  async function createShipment(order: Order, overrides: Partial<{ status: string; trackingNumber: string | null }> = {}): Promise<Shipment> {
    return sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId("shipments", t);
      return Shipment.create(
        {
          id, shipment_number: buildBusinessReference("shipment", id), source_type: "order", source_id: order.id, order_id: order.id,
          replacement_id: null, method: "standard", provider: "ithink", provider_order_id: `REF-${id}`,
          provider_shipment_id: null, carrier: "Courier A", tracking_number: overrides.trackingNumber === undefined ? `AWB-${id}` : overrides.trackingNumber,
          service_type: "Surface", status: (overrides.status ?? "awb_assigned") as never, provider_status: "Created", provider_status_code: null,
          pickup_warehouse_id: "warehouse-1", weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00",
          shipping_charge: "87.50", currency: "INR", shipped_at: null, delivered_at: null, cancelled_at: null, rto_at: null,
          last_synced_at: null, raw_payload: null
        },
        { transaction: t }
      );
    });
  }

  function mockTracking(status: string, statusCode: string | null = null) {
    return vi.spyOn(IThinkClient, "track").mockResolvedValue({
      awb: "AWB-TRACKED", courier: "Courier A", currentStatus: status, currentStatusCode: statusCode,
      events: [{ status, statusCode, location: "Mumbai Hub", message: null, eventAt: "2026-08-20 09:00:00" }]
    });
  }

  beforeAll(async () => { await connectDatabase(); });
  beforeEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await disconnectDatabase(); });

  describe("Shipment Created (AWB generated)", () => {
    it("triggers an email notification once a Shipment successfully gets an AWB", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-NEW", reference: "REF-NEW", courier: "Courier A", trackingUrl: null });
      const emailSpy = vi.spyOn(emailService, "sendEmail");

      const shipment = await ShipmentService.createForOrder(order.id);

      expect(shipment.status).toBe("awb_assigned");
      const logs = await NotificationLog.findAll({ where: { event_type: "SHIPMENT_CREATED", entity_type: "shipment", entity_id: shipment.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.status).toBe("sent");
      expect(emailSpy).toHaveBeenCalledTimes(1);
      const emailArgs = emailSpy.mock.calls[0]?.[0];
      expect(emailArgs?.subject).toContain(order.order_number);
      expect(emailArgs?.text).toContain("AWB-NEW");
      expect(emailArgs?.text).toContain("Courier A");
    });

    it("does not send a Shipment Created email when iThink accepts the booking without an AWB", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: null, reference: "REF-NO-AWB", courier: "Courier A", trackingUrl: null });

      const shipment = await ShipmentService.createForOrder(order.id);

      expect(shipment.status).toBe("provider_status_unknown");
      const logs = await NotificationLog.findAll({ where: { event_type: "SHIPMENT_CREATED", entity_type: "shipment", entity_id: shipment.id } });
      expect(logs).toHaveLength(0);
    });
  });

  describe("RTO notification", () => {
    it("sends a delivery-returning-to-origin email once, on the first RTO-initiated sync", async () => {
      const { order } = await createOrder();
      const shipment = await createShipment(order);
      mockTracking("RTO Pending");

      await ShipmentService.refresh(shipment.id);

      const refreshed = await Shipment.findByPk(shipment.id);
      expect(refreshed?.status).toBe("rto_initiated");
      const logs = await NotificationLog.findAll({ where: { event_type: "SHIPMENT_RTO_INITIATED", entity_type: "shipment", entity_id: shipment.id } });
      expect(logs).toHaveLength(1);
      expect(logs[0]?.status).toBe("sent");
    });
  });

  describe("NDR / delivery exception notification", () => {
    it("sends a generic delivery-attempt-failed email on NDR", async () => {
      const { order } = await createOrder();
      const shipment = await createShipment(order, { status: "out_for_delivery" });
      mockTracking("Undelivered");
      const emailSpy = vi.spyOn(emailService, "sendEmail");

      await ShipmentService.refresh(shipment.id);

      const refreshed = await Shipment.findByPk(shipment.id);
      expect(refreshed?.status).toBe("ndr");
      const logs = await NotificationLog.findAll({ where: { event_type: "SHIPMENT_DELIVERY_FAILED", entity_type: "shipment", entity_id: shipment.id } });
      expect(logs).toHaveLength(1);
      // Never leaks the raw courier remark/status text into the customer email.
      const emailArgs = emailSpy.mock.calls.find((call) => call[0]?.subject.includes("Delivery attempt failed"));
      expect(emailArgs?.[0]?.text).not.toContain("Undelivered");
    });

    it("collapses ndr and a later delivery_exception on the same shipment into a single email (dedup by shipment, not by raw status)", async () => {
      const { order } = await createOrder();
      const shipment = await createShipment(order, { status: "out_for_delivery" });
      mockTracking("Undelivered");
      await ShipmentService.refresh(shipment.id);

      mockTracking("Damaged"); // maps to delivery_exception — a different raw status, same notification event type
      await ShipmentService.refresh(shipment.id);

      const refreshed = await Shipment.findByPk(shipment.id);
      expect(refreshed?.status).toBe("delivery_exception");
      const logs = await NotificationLog.findAll({ where: { event_type: "SHIPMENT_DELIVERY_FAILED", entity_type: "shipment", entity_id: shipment.id } });
      expect(logs).toHaveLength(1); // still exactly one — the second attempt is deduped, not a fresh send
    });
  });

  describe("Deduplication", () => {
    it("does not send a duplicate Shipment Created email if create() is somehow invoked again for the same Shipment", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-DEDUPE", reference: "REF-DEDUPE", courier: "Courier A", trackingUrl: null });
      const emailSpy = vi.spyOn(emailService, "sendEmail");

      const first = await ShipmentService.createForOrder(order.id);
      const second = await ShipmentService.createForOrder(order.id); // existing non-failed shipment — returns the same row, create() short-circuits before booking again

      expect(second.id).toBe(first.id);
      const logs = await NotificationLog.findAll({ where: { event_type: "SHIPMENT_CREATED", entity_type: "shipment", entity_id: first.id } });
      expect(logs).toHaveLength(1);
      expect(emailSpy).toHaveBeenCalledTimes(1);
    });

    it("does not send a duplicate RTO email across two syncs both reporting RTO", async () => {
      const { order } = await createOrder();
      const shipment = await createShipment(order);
      mockTracking("RTO Pending");
      await ShipmentService.refresh(shipment.id);
      mockTracking("RTO Processing"); // also normalizes to rto_initiated
      await ShipmentService.refresh(shipment.id);

      const logs = await NotificationLog.findAll({ where: { event_type: "SHIPMENT_RTO_INITIATED", entity_type: "shipment", entity_id: shipment.id } });
      expect(logs).toHaveLength(1);
    });
  });

  describe("Regression — existing shipment notifications unchanged", () => {
    it("still sends Order Shipped on the courier's first picked_up scan", async () => {
      const { order } = await createOrder();
      const shipment = await createShipment(order);
      mockTracking("Picked Up");

      await ShipmentService.refresh(shipment.id);

      const refreshedOrder = await Order.findByPk(order.id);
      expect(refreshedOrder?.status).toBe("shipped");
      const logs = await NotificationLog.findAll({ where: { event_type: "ORDER_SHIPPED", entity_type: "order", entity_id: order.id } });
      expect(logs).toHaveLength(1);
    });

    it("still sends Out for Delivery", async () => {
      const { order } = await createOrder();
      const shipment = await createShipment(order, { status: "in_transit" });
      mockTracking("Out for Delivery");

      await ShipmentService.refresh(shipment.id);

      const logs = await NotificationLog.findAll({ where: { event_type: "ORDER_OUT_FOR_DELIVERY", entity_type: "shipment", entity_id: shipment.id } });
      expect(logs).toHaveLength(1);
    });

    it("still sends Order Delivered", async () => {
      const { order } = await createOrder();
      const shipment = await createShipment(order, { status: "out_for_delivery" });
      mockTracking("Delivered");

      await ShipmentService.refresh(shipment.id);

      const refreshedOrder = await Order.findByPk(order.id);
      expect(refreshedOrder?.status).toBe("delivered");
      const logs = await NotificationLog.findAll({ where: { event_type: "ORDER_DELIVERED", entity_type: "order", entity_id: order.id } });
      expect(logs).toHaveLength(1);
    });
  });
});
