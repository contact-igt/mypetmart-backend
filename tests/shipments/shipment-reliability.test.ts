/* eslint-disable */
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

import { Op } from "sequelize";

import { IThinkClient, IThinkClientError } from "../../src/models/ShipmentModels/ithink.client.js";
import { ShipmentService } from "../../src/models/ShipmentModels/shipment.service.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { Category, Order, OrderItem, Payment, Product, Shipment, ShipmentTrackingEvent } from "../../src/database/tables/index.js";

describe("Shipment Reliability Phase 1A", () => {
  const baseId = 991_000;
  let counter = 0;
  // Every destroy below is scoped to IDs this file itself created — a
  // blanket `where: {}` (the pattern ithink-contract.test.ts's own clean()
  // uses) risks deleting another concurrently-running test file's
  // in-flight row under a full-suite parallel run (observed as a
  // product_images FK error), since Product/Order/etc. tables are shared
  // across the whole test database.
  const createdCategoryIds: number[] = [];
  const createdOrderIds: number[] = [];

  async function clean(): Promise<void> {
    if (createdOrderIds.length === 0 && createdCategoryIds.length === 0) return;
    await ShipmentTrackingEvent.destroy({ where: { shipment_id: { [Op.in]: (await Shipment.findAll({ where: { order_id: { [Op.in]: createdOrderIds } }, attributes: ["id"] })).map((s) => s.id) } }, force: true });
    await Shipment.destroy({ where: { order_id: { [Op.in]: createdOrderIds } }, force: true });
    await Payment.destroy({ where: { order_id: { [Op.in]: createdOrderIds } }, force: true });
    await OrderItem.destroy({ where: { order_id: { [Op.in]: createdOrderIds } }, force: true });
    await Order.destroy({ where: { id: { [Op.in]: createdOrderIds } }, force: true });
    await Product.destroy({ where: { category_id: { [Op.in]: createdCategoryIds } }, force: true });
    await Category.destroy({ where: { id: { [Op.in]: createdCategoryIds } }, force: true });
    createdCategoryIds.length = 0;
    createdOrderIds.length = 0;
  }

  async function createOrder(
    overrides: {
      shipPhone?: string;
      shipPostalCode?: string;
      shipRecipientName?: string;
      weightGrams?: number | null;
      lengthCm?: string | null;
      widthCm?: string | null;
      heightCm?: string | null;
      paymentMethod?: "payu" | "cod";
    } = {}
  ) {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const category = await Category.create({ id: baseId + counter * 10, name: `Reliability ${suffix}`, slug: `reliability-${suffix}`, description: "Reliability test", pet_type: "all", active: true, display_order: 1 });
    createdCategoryIds.push(category.id);
    const product = await Product.create({
      id: category.id + 1, category_id: category.id, name: `Reliability Product ${suffix}`, slug: `reliability-product-${suffix}`, sku: `REL-${suffix}`,
      description: "Reliability test", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 20, has_variants: false, featured: false,
      tags: null, meta_title: null, meta_description: null,
      weight_grams: overrides.weightGrams === undefined ? 250 : overrides.weightGrams,
      length_cm: overrides.lengthCm === undefined ? "10.00" : overrides.lengthCm,
      width_cm: overrides.widthCm === undefined ? "8.00" : overrides.widthCm,
      height_cm: overrides.heightCm === undefined ? "5.00" : overrides.heightCm
    } as never);
    const isCod = overrides.paymentMethod === "cod";
    const order = await Order.create({
      id: category.id + 2, order_number: `ORD-${suffix}`, user_id: null, guest_identity_hash: null, guest_access_token_hash: null, cart_id: null,
      contact_email: "reliability@example.com", status: "confirmed", payment_status: isCod ? "pending" : "paid", fulfilment_status: "unfulfilled", commerce_exception: null,
      subtotal: "1000.00", shipping_fee: "0.00", total: "1000.00", currency: "INR",
      ship_recipient_name: overrides.shipRecipientName === undefined ? "Shipping Customer" : overrides.shipRecipientName,
      ship_phone: overrides.shipPhone === undefined ? "+91 98765 43210" : overrides.shipPhone,
      ship_line_1: "10 Test Street", ship_line_2: null, ship_city: "Mumbai", ship_state: "Maharashtra",
      ship_postal_code: overrides.shipPostalCode === undefined ? "400001" : overrides.shipPostalCode,
      ship_country: "IN", ship_latitude: null, ship_longitude: null, placed_at: new Date("2026-08-18T08:00:00.000Z"), cancelled_at: null
    });
    createdOrderIds.push(order.id);
    const item = await OrderItem.create({ id: category.id + 3, order_id: order.id, product_id: product.id, product_variant_id: null, product_name: product.name, product_sku: product.sku, variant_name: null, variant_sku: null, product_image: null, quantity: 2, unit_price: "500.00", line_total: "1000.00" });
    if (isCod) {
      await Payment.create({ id: category.id + 4, order_id: order.id, amount: order.total, currency: order.currency, provider: "cod", status: "pending", provider_order_id: null, provider_payment_id: null, method: "cod", raw_payload: null });
    }
    return { order, item, product };
  }

  function mockSuccessfulProvider() {
    vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
    vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
    return vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: `AWB-${counter}`, reference: `REF-${counter}`, courier: "Courier A", trackingUrl: "https://track.example/AWB" });
  }

  beforeAll(async () => { await connectDatabase(); });
  beforeEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await disconnectDatabase(); });

  // -------------------------------------------------------------------
  // Phase 1 — Failure reason persistence
  // -------------------------------------------------------------------
  describe("Failure reason persistence", () => {
    it("persists the real iThink rejection reason, not just the error code", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      vi.spyOn(IThinkClient, "createShipment").mockRejectedValue(new IThinkClientError("CREATE_REJECTED", "Pickup address invalid"));

      await expect(ShipmentService.createForOrder(order.id)).rejects.toMatchObject({ code: "ITHINK_CREATE_REJECTED" });

      const shipment = await ShipmentService.getForOrder(order.id);
      expect(shipment?.status).toBe("failed");
      expect(shipment?.providerStatus).toBe("CREATE_REJECTED");
      expect(shipment?.failureReason).toMatchObject({ provider: "ithink", errorCode: "CREATE_REJECTED", message: "Pickup address invalid" });
      expect(typeof shipment?.failureReason?.failedAt).toBe("string");
    });

    it("existing shipment status remains 'failed' after a rejection", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      vi.spyOn(IThinkClient, "createShipment").mockRejectedValue(new IThinkClientError("CREATE_REJECTED", "Missing field"));
      await expect(ShipmentService.createForOrder(order.id)).rejects.toBeDefined();
      const shipment = await Shipment.findOne({ where: { order_id: order.id } });
      expect(shipment?.status).toBe("failed");
    });

    it("success flow still stores success data (trackingUrl) in raw_payload", async () => {
      const { order } = await createOrder();
      mockSuccessfulProvider();
      const shipment = await ShipmentService.createForOrder(order.id);
      expect(shipment.status).toBe("awb_assigned");
      expect(shipment.failureReason).toBeNull();
      const row = await Shipment.findByPk(shipment.id);
      const rawPayload = typeof row?.raw_payload === "string" ? JSON.parse(row.raw_payload) : row?.raw_payload;
      expect(rawPayload).toMatchObject({ trackingUrl: "https://track.example/AWB" });
    });
  });

  // -------------------------------------------------------------------
  // Phase 3 — Retry
  // -------------------------------------------------------------------
  describe("Retry", () => {
    it("retries a failed shipment by reusing the existing creation flow", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      const createSpy = vi.spyOn(IThinkClient, "createShipment").mockRejectedValueOnce(new IThinkClientError("CREATE_REJECTED", "Pickup address invalid"));
      await expect(ShipmentService.createForOrder(order.id)).rejects.toBeDefined();

      const failed = await Shipment.findOne({ where: { order_id: order.id } });
      expect(failed?.status).toBe("failed");

      createSpy.mockResolvedValueOnce({ awb: "AWB-RETRY", reference: "REF-RETRY", courier: "Courier A", trackingUrl: null });
      const retried = await ShipmentService.retry(failed!.id);

      expect(retried.id).toBe(failed!.id);
      expect(retried.status).toBe("awb_assigned");
      expect(retried.awbNumber).toBe("AWB-RETRY");
      expect(createSpy).toHaveBeenCalledTimes(2);
      // Exactly one Shipment row for this Order across the failed attempt and the retry.
      expect(await Shipment.count({ where: { order_id: order.id } })).toBe(1);
    });

    it("rejects retrying a shipment that is not currently failed", async () => {
      const { order } = await createOrder();
      mockSuccessfulProvider();
      const shipment = await ShipmentService.createForOrder(order.id);
      await expect(ShipmentService.retry(shipment.id)).rejects.toMatchObject({ code: "SHIPMENT_ACTION_NOT_ALLOWED" });
    });

    it("rejects retrying a non-existent shipment", async () => {
      await expect(ShipmentService.retry(999_999_999)).rejects.toMatchObject({ code: "SHIPMENT_NOT_FOUND" });
    });
  });

  // -------------------------------------------------------------------
  // Phase 4 — Pre-shipment validation
  // -------------------------------------------------------------------
  describe("Pre-shipment validation", () => {
    it("blocks a missing product weight/dimensions before calling iThink", async () => {
      const { order } = await createOrder({ weightGrams: null, lengthCm: null, widthCm: null, heightCm: null });
      const createSpy = vi.spyOn(IThinkClient, "createShipment");
      const serviceableSpy = vi.spyOn(IThinkClient, "checkServiceability");
      await expect(ShipmentService.createForOrder(order.id)).rejects.toMatchObject({ code: "SHIPMENT_VALIDATION_FAILED" });
      expect(serviceableSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();
      expect(await Shipment.count({ where: { order_id: order.id } })).toBe(0);
    });

    it("blocks an invalid customer phone number before calling iThink", async () => {
      const { order } = await createOrder({ shipPhone: "12345" });
      const serviceableSpy = vi.spyOn(IThinkClient, "checkServiceability");
      const error = await ShipmentService.createForOrder(order.id).catch((e) => e);
      expect(error).toMatchObject({ code: "SHIPMENT_VALIDATION_FAILED" });
      expect(error.details.missing).toContain("Customer phone number");
      expect(serviceableSpy).not.toHaveBeenCalled();
    });

    it("blocks an invalid pincode before calling iThink", async () => {
      const { order } = await createOrder({ shipPostalCode: "ABCDEF" });
      const serviceableSpy = vi.spyOn(IThinkClient, "checkServiceability");
      const error = await ShipmentService.createForOrder(order.id).catch((e) => e);
      expect(error).toMatchObject({ code: "SHIPMENT_VALIDATION_FAILED" });
      expect(error.details.missing).toContain("Shipping pincode");
      expect(serviceableSpy).not.toHaveBeenCalled();
    });

    it("collects multiple issues into one error instead of failing on the first", async () => {
      const { order } = await createOrder({ shipPhone: "123", shipPostalCode: "9", weightGrams: null, lengthCm: null, widthCm: null, heightCm: null });
      const error = await ShipmentService.createForOrder(order.id).catch((e) => e);
      expect(error.code).toBe("SHIPMENT_VALIDATION_FAILED");
      expect(error.details.missing).toEqual(expect.arrayContaining(["Customer phone number", "Shipping pincode"]));
      expect(error.details.missing.length).toBeGreaterThanOrEqual(2);
    });

    it("does not block a fully valid Order", async () => {
      const { order } = await createOrder();
      mockSuccessfulProvider();
      await expect(ShipmentService.createForOrder(order.id)).resolves.toMatchObject({ status: "awb_assigned" });
    });
  });

  // -------------------------------------------------------------------
  // Phase 5 — COD payload fix
  // -------------------------------------------------------------------
  describe("COD shipment payload", () => {
    it("sends payment_mode COD and cod_amount = order total for a COD-confirmed Order", async () => {
      const { order } = await createOrder({ paymentMethod: "cod" });
      const createSpy = mockSuccessfulProvider();
      await ShipmentService.createForOrder(order.id);
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentMode: "COD", codAmount: "1000.00" }));
    });

    it("keeps PayU shipments as Prepaid with cod_amount 0", async () => {
      const { order } = await createOrder();
      const createSpy = mockSuccessfulProvider();
      await ShipmentService.createForOrder(order.id);
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentMode: "Prepaid", codAmount: "0" }));
    });

    it("never trusts a client-supplied payment mode — COD is derived purely from the Order's own Payment record", async () => {
      // No Payment row of provider "cod" exists (PayU-eligible order created
      // directly with payment_status: "paid") — even though nothing in this
      // call path accepts a payment-mode parameter at all, this documents
      // that the derivation is unconditionally server-side.
      const { order } = await createOrder();
      const createSpy = mockSuccessfulProvider();
      await ShipmentService.createForOrder(order.id);
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentMode: "Prepaid" }));
    });
  });

  // -------------------------------------------------------------------
  // Phase 1B.2 — Pre-shipment serviceability check
  // -------------------------------------------------------------------
  describe("Serviceability check", () => {
    it("checks serviceability (and rates) with payment mode 'cod' for a COD Order, then proceeds to create the shipment", async () => {
      const { order } = await createOrder({ paymentMethod: "cod" });
      const serviceableSpy = vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      const ratesSpy = vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      const createSpy = vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-COD-SVC", reference: "REF-COD-SVC", courier: "Courier A", trackingUrl: null });

      const result = await ShipmentService.createForOrder(order.id);

      expect(serviceableSpy).toHaveBeenCalledWith(order.ship_postal_code, "cod");
      expect(ratesSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentMode: "cod" }));
      expect(createSpy).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("awb_assigned");
    });

    it("checks serviceability (and rates) with payment mode 'prepaid' for a PayU Order — success flow unchanged, AWB still generated", async () => {
      const { order } = await createOrder();
      const serviceableSpy = vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      const ratesSpy = vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-PREPAID-SVC", reference: "REF-PREPAID-SVC", courier: "Courier A", trackingUrl: null });

      const result = await ShipmentService.createForOrder(order.id);

      expect(serviceableSpy).toHaveBeenCalledWith(order.ship_postal_code, "prepaid");
      expect(ratesSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentMode: "prepaid" }));
      expect(result.status).toBe("awb_assigned");
      expect(result.awbNumber).toBe("AWB-PREPAID-SVC");
    });

    it("never calls iThink's order/add when the destination pincode has no serviceable courier, and persists a clear reason", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue([]);
      const ratesSpy = vi.spyOn(IThinkClient, "getRates");
      const createSpy = vi.spyOn(IThinkClient, "createShipment");

      const error = await ShipmentService.createForOrder(order.id).catch((e) => e);

      expect(error.code).toBe("SHIPMENT_DESTINATION_UNSERVICEABLE");
      expect(ratesSpy).not.toHaveBeenCalled();
      expect(createSpy).not.toHaveBeenCalled();

      const shipment = await ShipmentService.getForOrder(order.id);
      expect(shipment?.status).toBe("failed");
      expect(shipment?.failureReason).toMatchObject({ provider: "ithink", errorCode: "SERVICEABILITY_FAILED" });
      expect(shipment?.failureReason?.message).toContain(order.ship_postal_code);
    });

    it("never calls iThink's order/add when no rate is available for the payment mode, and persists a clear reason", async () => {
      const { order } = await createOrder({ paymentMethod: "cod" });
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([]); // pincode covered, but no COD-capable rate returned
      const createSpy = vi.spyOn(IThinkClient, "createShipment");

      const error = await ShipmentService.createForOrder(order.id).catch((e) => e);

      expect(error.code).toBe("SHIPMENT_RATE_UNAVAILABLE");
      expect(createSpy).not.toHaveBeenCalled();

      const shipment = await ShipmentService.getForOrder(order.id);
      expect(shipment?.status).toBe("failed");
      expect(shipment?.failureReason).toMatchObject({ provider: "ithink", errorCode: "SERVICEABILITY_FAILED" });
      expect(shipment?.failureReason?.message).toContain("Cash on Delivery");
    });

    it("re-runs serviceability against the corrected pincode when a failed shipment is retried", async () => {
      const { order } = await createOrder({ shipPostalCode: "400001" });
      const serviceableSpy = vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValueOnce([]); // first attempt: unserviceable
      vi.spyOn(IThinkClient, "getRates");
      await expect(ShipmentService.createForOrder(order.id)).rejects.toBeDefined();
      const failed = await Shipment.findOne({ where: { order_id: order.id } });
      expect(failed?.status).toBe("failed");

      // Correct the pincode directly on the Order (mirrors what
      // AdminOrderService.updateShippingAddress does — this test isolates
      // the serviceability re-check itself; the endpoint-level flow is
      // covered in tests/orders/admin-shipping-address.test.ts).
      await Order.update({ ship_postal_code: "600077" }, { where: { id: order.id } });

      serviceableSpy.mockResolvedValueOnce(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-RETRY-SVC", reference: "REF-RETRY-SVC", courier: "Courier A", trackingUrl: null });

      const retried = await ShipmentService.retry(failed!.id);

      expect(retried.status).toBe("awb_assigned");
      expect(serviceableSpy).toHaveBeenLastCalledWith("600077", "prepaid");
    });
  });

  // -------------------------------------------------------------------
  // Phase 1C — Quote API + manual courier selection
  // -------------------------------------------------------------------
  describe("Shipment quote", () => {
    function mockTwoCandidates() {
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a", "courier b"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([
        { courier: "Courier A", serviceType: "Surface", rate: "87.50" },
        { courier: "Courier B", serviceType: "Air", rate: "48.00" }
      ]);
    }

    it("returns multiple options, sorted by rate, without creating a Shipment", async () => {
      const { order } = await createOrder();
      mockTwoCandidates();
      const createSpy = vi.spyOn(IThinkClient, "createShipment");

      const result = await ShipmentService.quoteForOrder(order.id);

      expect(result.options).toEqual([
        { carrier: "Courier B", serviceType: "Air", rate: "48.00" },
        { carrier: "Courier A", serviceType: "Surface", rate: "87.50" }
      ]);
      expect(createSpy).not.toHaveBeenCalled();
      expect(await Shipment.count({ where: { order_id: order.id } })).toBe(0);
    });

    it("returns an empty options list (not an error) when the destination is unserviceable", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue([]);
      const ratesSpy = vi.spyOn(IThinkClient, "getRates");

      const result = await ShipmentService.quoteForOrder(order.id);

      expect(result.options).toEqual([]);
      expect(ratesSpy).not.toHaveBeenCalled();
      expect(await Shipment.count({ where: { order_id: order.id } })).toBe(0);
    });

    it("still enforces eligibility for a quote — an ineligible Order is rejected before any iThink call", async () => {
      const { order } = await createOrder();
      await Order.update({ payment_status: "pending" }, { where: { id: order.id } }); // not COD, not paid
      const serviceableSpy = vi.spyOn(IThinkClient, "checkServiceability");

      await expect(ShipmentService.quoteForOrder(order.id)).rejects.toMatchObject({ code: "SHIPMENT_NOT_ELIGIBLE" });
      expect(serviceableSpy).not.toHaveBeenCalled();
    });

    it("quotes with payment mode 'cod' for a COD Order", async () => {
      const { order } = await createOrder({ paymentMethod: "cod" });
      mockTwoCandidates();
      const ratesSpy = vi.spyOn(IThinkClient, "getRates");

      await ShipmentService.quoteForOrder(order.id);

      expect(ratesSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentMode: "cod" }));
    });

    // Regression test for the quote-endpoint bug: checkServiceability/getRates
    // throwing a raw IThinkClientError (provider-side rejection, network
    // failure) previously propagated unconverted out of quote() — since it
    // is neither an ApplicationError nor a ZodError, errorHandlerMiddleware's
    // default branch turned it into a generic 500 "An unexpected error
    // occurred." with no useful message. quote() must convert it the same
    // way create() already does for its own equivalent call.
    it("converts a raw iThink provider error into a proper SERVICEABILITY_FAILED error instead of a generic internal error", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockRejectedValue(new IThinkClientError("SERVICEABILITY_CHECK_FAILED", "Access Token Not Match."));

      const error = await ShipmentService.quoteForOrder(order.id).catch((e) => e);

      expect(error).not.toBeInstanceOf(IThinkClientError); // never leaks the raw client error to the caller
      expect(error.code).toBe("SERVICEABILITY_FAILED");
      expect(error.message).toBe("Access Token Not Match.");
      expect(error.statusCode).toBe(502);
    });

    it("converts a raw iThink provider error from getRates the same way", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockRejectedValue(new IThinkClientError("PROVIDER_UNAVAILABLE", "iThink Logistics did not return a response."));

      const error = await ShipmentService.quoteForOrder(order.id).catch((e) => e);

      expect(error.code).toBe("SERVICEABILITY_FAILED");
      expect(error.message).toBe("iThink Logistics did not return a response.");
    });
  });

  describe("Manual courier selection", () => {
    it("uses the selected (non-cheapest) courier for shipment creation instead of the automatic cheapest pick", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a", "courier b"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([
        { courier: "Courier A", serviceType: "Surface", rate: "87.50" },
        { courier: "Courier B", serviceType: "Air", rate: "48.00" } // cheaper — would win automatically
      ]);
      const createSpy = vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-SELECTED", reference: "REF-SELECTED", courier: "Courier A", trackingUrl: null });

      const result = await ShipmentService.createForOrder(order.id, { carrier: "Courier A", serviceType: "Surface" });

      expect(result.carrier).toBe("Courier A");
      expect(result.serviceType).toBe("Surface");
      expect(result.providerCost).toBe("87.50");
      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ logistics: "Courier A", serviceType: "Surface" }));
    });

    it("rejects a stale/invalid courier selection without booking or falling back to automatic selection", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      const createSpy = vi.spyOn(IThinkClient, "createShipment");

      const error = await ShipmentService.createForOrder(order.id, { carrier: "FakeCourier", serviceType: "999" }).catch((e) => e);

      expect(error.code).toBe("SHIPMENT_COURIER_SELECTION_INVALID");
      expect(error.message).toBe("Selected courier is unavailable.");
      expect(createSpy).not.toHaveBeenCalled();

      // The rejected shipment lands in "failed" (not stuck in "pending"),
      // exactly like every other create()-time rejection — this is what
      // keeps it retryable through the existing ShipmentService.retry()
      // (which only accepts status:"failed"; see its own guard).
      const shipment = await ShipmentService.getForOrder(order.id);
      expect(shipment?.status).toBe("failed");
      expect(shipment?.failureReason).toMatchObject({ errorCode: "COURIER_SELECTION_INVALID", message: "Selected courier is unavailable." });
    });

    it("falls back to the automatic cheapest courier when no selection is provided", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a", "courier b"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([
        { courier: "Courier A", serviceType: "Surface", rate: "87.50" },
        { courier: "Courier B", serviceType: "Air", rate: "48.00" }
      ]);
      vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-AUTO", reference: "REF-AUTO", courier: "Courier B", trackingUrl: null });

      const result = await ShipmentService.createForOrder(order.id);

      expect(result.carrier).toBe("Courier B");
      expect(result.providerCost).toBe("48.00");
    });

    it("keeps a manually-selected COD shipment sending payment_mode COD to the booking call", async () => {
      const { order } = await createOrder({ paymentMethod: "cod" });
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      const createSpy = vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-COD-SEL", reference: "REF-COD-SEL", courier: "Courier A", trackingUrl: null });

      await ShipmentService.createForOrder(order.id, { carrier: "Courier A", serviceType: "Surface" });

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentMode: "COD", codAmount: "1000.00" }));
    });

    it("keeps a manually-selected PayU shipment sending payment_mode Prepaid to the booking call", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      const createSpy = vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-PREPAID-SEL", reference: "REF-PREPAID-SEL", courier: "Courier A", trackingUrl: null });

      await ShipmentService.createForOrder(order.id, { carrier: "Courier A", serviceType: "Surface" });

      expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ paymentMode: "Prepaid", codAmount: "0" }));
    });

    it("retry never requires (or accepts) a manual selection — always re-runs the automatic cheapest pick", async () => {
      const { order } = await createOrder();
      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
      vi.spyOn(IThinkClient, "createShipment").mockRejectedValueOnce(new IThinkClientError("CREATE_REJECTED", "temporary"));
      await expect(ShipmentService.createForOrder(order.id)).rejects.toBeDefined();
      const failed = await Shipment.findOne({ where: { order_id: order.id } });

      vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a", "courier b"]);
      vi.spyOn(IThinkClient, "getRates").mockResolvedValue([
        { courier: "Courier A", serviceType: "Surface", rate: "87.50" },
        { courier: "Courier B", serviceType: "Air", rate: "48.00" }
      ]);
      vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: "AWB-RETRY-AUTO", reference: "REF-RETRY-AUTO", courier: "Courier B", trackingUrl: null });

      const retried = await ShipmentService.retry(failed!.id);

      expect(retried.carrier).toBe("Courier B"); // cheapest, automatic — retry() takes no selection argument at all
    });
  });
});
