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
import { runShipmentSyncBatch } from "../../src/models/ShipmentModels/shipment-sync.job.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { Category, Order, OrderItem, Product, Shipment, ShipmentTrackingEvent } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";

describe("Shipment tracking sync job (Phase 1D.1)", () => {
  const baseId = 992_000;
  let counter = 0;
  const createdCategoryIds: number[] = [];
  const createdOrderIds: number[] = [];

  async function clean(): Promise<void> {
    if (createdOrderIds.length === 0 && createdCategoryIds.length === 0) return;
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
    const category = await Category.create({ id: baseId + counter * 20, name: `Sync ${suffix}`, slug: `sync-${suffix}`, description: "Sync test", pet_type: "all", active: true, display_order: 1 });
    createdCategoryIds.push(category.id);
    const product = await Product.create({
      id: category.id + 1, category_id: category.id, name: `Sync Product ${suffix}`, slug: `sync-product-${suffix}`, sku: `SYNC-${suffix}`,
      description: "Sync test", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 20, has_variants: false, featured: false,
      tags: null, meta_title: null, meta_description: null, weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00"
    } as never);
    const order = await Order.create({
      id: category.id + 2, order_number: `ORD-${suffix}`, user_id: null, guest_identity_hash: null, guest_access_token_hash: null, cart_id: null,
      contact_email: "sync@example.com", status: "confirmed", payment_status: "paid", fulfilment_status: "unfulfilled", commerce_exception: null,
      subtotal: "1000.00", shipping_fee: "0.00", total: "1000.00", currency: "INR",
      ship_recipient_name: "Sync Customer", ship_phone: "+91 98765 43210", ship_line_1: "10 Test Street", ship_line_2: null,
      ship_city: "Mumbai", ship_state: "Maharashtra", ship_postal_code: "400001", ship_country: "IN", ship_latitude: null, ship_longitude: null,
      placed_at: new Date("2026-08-18T08:00:00.000Z"), cancelled_at: null
    });
    createdOrderIds.push(order.id);
    await OrderItem.create({ id: category.id + 3, order_id: order.id, product_id: product.id, product_variant_id: null, product_name: product.name, product_sku: product.sku, variant_name: null, variant_sku: null, product_image: null, quantity: 1, unit_price: "500.00", line_total: "500.00" });
    return { order };
  }

  // Creates a Shipment row directly (bypassing ShipmentService.create()'s
  // full flow, which needs a real/mocked iThink booking round-trip) — this
  // job only cares about existing Shipment rows and their eligibility
  // fields, so constructing them directly keeps these tests focused on the
  // sync job itself, not shipment creation (already covered elsewhere).
  async function createShipment(order: Order, overrides: Partial<{ status: string; trackingNumber: string | null; lastSyncedAt: Date | null }> = {}): Promise<Shipment> {
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
          last_synced_at: overrides.lastSyncedAt === undefined ? new Date(Date.now() - 60 * 60 * 1000) : overrides.lastSyncedAt, // 1h ago = stale by default
          raw_payload: null
        },
        { transaction: t }
      );
    });
  }

  function mockTrackingResponse(overrides: Partial<{ currentStatus: string; currentStatusCode: string | null }> = {}) {
    return vi.spyOn(IThinkClient, "track").mockResolvedValue({
      awb: "AWB-TRACKED", courier: "Courier A", currentStatus: overrides.currentStatus ?? "In Transit", currentStatusCode: overrides.currentStatusCode ?? "IT",
      events: [{ status: overrides.currentStatus ?? "In Transit", statusCode: overrides.currentStatusCode ?? "IT", location: "Mumbai Hub", message: null, eventAt: "2026-08-20 09:00:00" }]
    });
  }

  beforeAll(async () => { await connectDatabase(); });
  beforeEach(async () => {
    vi.restoreAllMocks();
    mockedShippingConfig.ready = true;
    mockedShippingConfig.provider = "ithink";
    await clean();
  });
  afterAll(async () => { await clean(); await disconnectDatabase(); });

  describe("Shipment selection", () => {
    it("finds and syncs an active, stale shipment via the existing refresh() pipeline", async () => {
      const { order } = await createOrder();
      const shipment = await createShipment(order);
      const trackSpy = mockTrackingResponse();

      const result = await runShipmentSyncBatch();

      expect(result).toEqual({ attempted: 1, succeeded: 1, failed: 0 });
      expect(trackSpy).toHaveBeenCalledWith(shipment.tracking_number);
      // Proves the FULL refresh()->ingest() pipeline ran (not some bypass):
      // a real ShipmentTrackingEvent row was created and status advanced.
      const events = await ShipmentTrackingEvent.findAll({ where: { shipment_id: shipment.id } });
      expect(events).toHaveLength(1);
      const refreshed = await Shipment.findByPk(shipment.id);
      expect(refreshed?.status).toBe("in_transit");
      expect(refreshed?.last_synced_at).not.toBeNull();
    });

    it("ignores delivered shipments", async () => {
      const { order } = await createOrder();
      await createShipment(order, { status: "delivered" });
      const trackSpy = mockTrackingResponse();

      const result = await runShipmentSyncBatch();

      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
      expect(trackSpy).not.toHaveBeenCalled();
    });

    it("ignores cancelled shipments", async () => {
      const { order } = await createOrder();
      await createShipment(order, { status: "cancelled" });
      const trackSpy = mockTrackingResponse();

      await runShipmentSyncBatch();

      expect(trackSpy).not.toHaveBeenCalled();
    });

    it("ignores rto_delivered shipments", async () => {
      const { order } = await createOrder();
      await createShipment(order, { status: "rto_delivered" });
      const trackSpy = mockTrackingResponse();

      await runShipmentSyncBatch();

      expect(trackSpy).not.toHaveBeenCalled();
    });

    it("ignores shipments with no AWB/tracking number yet", async () => {
      const { order } = await createOrder();
      await createShipment(order, { trackingNumber: null });
      const trackSpy = mockTrackingResponse();

      await runShipmentSyncBatch();

      expect(trackSpy).not.toHaveBeenCalled();
    });

    it("ignores shipments synced recently (not yet stale)", async () => {
      const { order } = await createOrder();
      await createShipment(order, { lastSyncedAt: new Date() });
      const trackSpy = mockTrackingResponse();

      await runShipmentSyncBatch();

      expect(trackSpy).not.toHaveBeenCalled();
    });

    it("includes a shipment that has never been synced (last_synced_at null)", async () => {
      const { order } = await createOrder();
      await createShipment(order, { lastSyncedAt: null });
      const trackSpy = mockTrackingResponse();

      const result = await runShipmentSyncBatch();

      expect(result.attempted).toBe(1);
      expect(trackSpy).toHaveBeenCalledTimes(1);
    });

    it("skips provider_status_unknown shipments — an admin action (cancel/reattempt/RTO) may have it claimed", async () => {
      const { order } = await createOrder();
      await createShipment(order, { status: "provider_status_unknown" });
      const trackSpy = mockTrackingResponse();

      await runShipmentSyncBatch();

      expect(trackSpy).not.toHaveBeenCalled();
    });

    it("skips the whole batch (no query, no iThink calls) when shipping is not configured", async () => {
      const { order } = await createOrder();
      await createShipment(order);
      mockedShippingConfig.ready = false;
      const trackSpy = mockTrackingResponse();

      const result = await runShipmentSyncBatch();

      expect(result).toEqual({ attempted: 0, succeeded: 0, failed: 0 });
      expect(trackSpy).not.toHaveBeenCalled();
    });
  });

  describe("Batch size", () => {
    it("caps a single run at 50 shipments even when more are eligible", async () => {
      for (let i = 0; i < 51; i += 1) {
        const { order } = await createOrder();
        await createShipment(order);
      }
      mockTrackingResponse();

      const result = await runShipmentSyncBatch();

      expect(result.attempted).toBe(50);
    }, 30_000);
  });

  describe("Error isolation", () => {
    it("one shipment's refresh failure does not stop the rest of the batch", async () => {
      const { order: orderA } = await createOrder();
      const shipmentA = await createShipment(orderA);
      const { order: orderB } = await createOrder();
      const shipmentB = await createShipment(orderB);

      vi.spyOn(IThinkClient, "track").mockImplementation(async (awb: string) => {
        if (awb === shipmentA.tracking_number) throw new Error("iThink tracking temporarily unavailable");
        return { awb, courier: "Courier A", currentStatus: "In Transit", currentStatusCode: "IT", events: [{ status: "In Transit", statusCode: "IT", location: "Mumbai Hub", message: null, eventAt: "2026-08-20 09:00:00" }] };
      });

      const result = await runShipmentSyncBatch();

      expect(result.attempted).toBe(2);
      expect(result.succeeded).toBe(1);
      expect(result.failed).toBe(1);

      // Shipment B still got synced despite Shipment A's failure.
      const refreshedB = await Shipment.findByPk(shipmentB.id);
      expect(refreshedB?.status).toBe("in_transit");
      const refreshedA = await Shipment.findByPk(shipmentA.id);
      expect(refreshedA?.status).toBe("awb_assigned"); // untouched by the failed attempt
    });
  });
});
