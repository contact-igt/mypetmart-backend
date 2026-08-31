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

import { IThinkClient, IThinkClientError, type IThinkPackageInput } from "../../src/models/ShipmentModels/ithink.client.js";
import { canAdvanceShipmentStatus, normalizeIThinkStatus } from "../../src/models/ShipmentModels/shipment.service.js";
import { ShipmentService } from "../../src/models/ShipmentModels/shipment.service.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { Category, Order, OrderItem, Product, ProductFeature, ProductMediaAssignment, ProductReview, Replacement, ReturnRequest, Shipment, ShipmentTrackingEvent, User } from "../../src/database/tables/index.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sentRequest(fetchMock: ReturnType<typeof vi.fn>): { url: string; data: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  if (typeof init.body !== "string") throw new Error("Expected a JSON request body.");
  return { url, data: (JSON.parse(init.body) as { data: Record<string, unknown> }).data };
}

function createShipmentInput(orderNumber = "ORD-1"): IThinkPackageInput {
  return {
    orderNumber, orderDate: "2026-08-18", totalAmount: "999.00",
    recipient: { name: "Alex", address1: "Line 1", address2: "Line 2", pincode: "400001", city: "Mumbai", state: "Maharashtra", country: "India", phone: "9876543210", email: "alex@example.com" },
    products: [{ name: "Dog Food", sku: "DOG-1", quantity: 2, price: "499.50" }],
    lengthCm: "10.00", widthCm: "8.00", heightCm: "12.00", weightKg: "1.000", logistics: "Courier A", serviceType: "Surface",
    paymentMode: "Prepaid", codAmount: "0"
  };
}

describe("iThink Logistics V3 request contracts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockedShippingConfig.storeId = "27377";
  });

  it("maps serviceability to the official pincode endpoint and keeps only prepaid pickup couriers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: { "400001": { BlueDart: { prepaid: "Y", cod: "N", pickup: "Y" }, CodOnly: { prepaid: "N", cod: "Y", pickup: "Y" } } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.checkServiceability("400001", "prepaid")).resolves.toEqual(["bluedart"]);
    const request = sentRequest(fetchMock);
    expect(request.url).toBe("https://pre-alpha.ithinklogistics.com/api_v3/pincode/check.json");
    expect(request.data).toMatchObject({ pincode: "400001", access_token: "test-access-token", secret_key: "test-secret-key" });
  });

  it("keeps only COD-capable couriers when checking serviceability for a COD Order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: { "400001": { BlueDart: { prepaid: "Y", cod: "N", pickup: "Y" }, CodOnly: { prepaid: "N", cod: "Y", pickup: "Y" } } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.checkServiceability("400001", "cod")).resolves.toEqual(["codonly"]);
  });

  it("surfaces a provider-side serviceability rejection instead of treating it as no couriers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "error", html_message: "Access Token Not Match." })));
    await expect(IThinkClient.checkServiceability("400001", "prepaid")).rejects.toMatchObject({ code: "SERVICEABILITY_CHECK_FAILED", message: "Access Token Not Match." });
  });

  it("maps rate inputs and accepts only prepaid pickup services for a Prepaid Order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: [
      { logistic_name: "Courier A", logistic_service_type: "Surface", prepaid: "Y", cod: "N", pickup: "Y", rate: "87.50" },
      { logistic_name: "Courier B", logistic_service_type: "Air", prepaid: "N", cod: "Y", pickup: "Y", rate: "99.00" }
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.getRates({ toPincode: "400001", lengthCm: "10.00", widthCm: "8.00", heightCm: "6.00", weightKg: "0.500", productMrp: "999.00", paymentMode: "prepaid" })).resolves.toEqual([{ courier: "Courier A", serviceType: "Surface", rate: "87.50", deliveryTat: null, estimatedDelivery: null }]);
    const request = sentRequest(fetchMock);
    expect(request.data).toMatchObject({ from_pincode: "600001", to_pincode: "400001", shipping_weight_kg: "0.500", order_type: "forward", payment_method: "prepaid", delivery_type: "0" });
    expect(request.data).not.toHaveProperty("store_id");
  });

  it("maps rate inputs and accepts only COD-capable services for a COD Order", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: [
      { logistic_name: "Courier A", logistic_service_type: "Surface", prepaid: "Y", cod: "N", pickup: "Y", rate: "87.50" },
      { logistic_name: "Courier B", logistic_service_type: "Air", prepaid: "N", cod: "Y", pickup: "Y", rate: "99.00" }
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.getRates({ toPincode: "400001", lengthCm: "10.00", widthCm: "8.00", heightCm: "6.00", weightKg: "0.500", productMrp: "999.00", paymentMode: "cod" })).resolves.toEqual([{ courier: "Courier B", serviceType: "Air", rate: "99.00", deliveryTat: null, estimatedDelivery: null }]);
    const request = sentRequest(fetchMock);
    expect(request.data).toMatchObject({ payment_method: "cod" });
  });

  // Phase 2A.2 — live-verified against the configured account (Phase 2A.1):
  // delivery_tat is per courier, edd_date is one shared min/max window for
  // the whole rate-check response.
  it("parses delivery_tat and edd_date.min_edd/max_edd from the Rate API response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: [
      { logistic_name: "Courier A", logistic_service_type: "Surface", prepaid: "Y", cod: "N", pickup: "Y", rate: "87.50", delivery_tat: "4" },
      { logistic_name: "Courier B", logistic_service_type: "Air", prepaid: "Y", cod: "N", pickup: "Y", rate: "99.00", delivery_tat: "2" }
    ], zone: "C", expected_delivery_date: "2 to 5 Days", edd_date: { min_edd: "2026-08-29", max_edd: "2026-09-01" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.getRates({ toPincode: "400001", lengthCm: "10.00", widthCm: "8.00", heightCm: "6.00", weightKg: "0.500", productMrp: "999.00", paymentMode: "prepaid" })).resolves.toEqual([
      { courier: "Courier A", serviceType: "Surface", rate: "87.50", deliveryTat: 4, estimatedDelivery: { min: "2026-08-29", max: "2026-09-01" } },
      { courier: "Courier B", serviceType: "Air", rate: "99.00", deliveryTat: 2, estimatedDelivery: { min: "2026-08-29", max: "2026-09-01" } }
    ]);
  });

  it("treats a missing or malformed edd_date/delivery_tat as no estimate, never a guess", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: [
      { logistic_name: "Courier A", logistic_service_type: "Surface", prepaid: "Y", cod: "N", pickup: "Y", rate: "87.50", delivery_tat: "not-a-number" }
    ], edd_date: { min_edd: "not-a-date", max_edd: "2026-09-01" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.getRates({ toPincode: "400001", lengthCm: "10.00", widthCm: "8.00", heightCm: "6.00", weightKg: "0.500", productMrp: "999.00", paymentMode: "prepaid" })).resolves.toEqual([
      { courier: "Courier A", serviceType: "Surface", rate: "87.50", deliveryTat: null, estimatedDelivery: null }
    ]);
  });

  it("maps a forward prepaid shipment without changing the commerce total", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: { "1": { status: "success", waybill: "AWB123", refnum: "REF123", logistic_name: "Courier A", tracking_url: "https://track.example/AWB123" } } }));
    vi.stubGlobal("fetch", fetchMock);
    const shipmentNumber = buildBusinessReference("shipment", 1);
    await expect(IThinkClient.createShipment(createShipmentInput(shipmentNumber))).resolves.toMatchObject({ awb: "AWB123", reference: "REF123", courier: "Courier A" });
    const request = sentRequest(fetchMock);
    expect(request.url).toContain("/api_v3/order/add.json");
    expect(request.data).toMatchObject({
      access_token: "test-access-token",
      secret_key: "test-secret-key",
      pickup_address_id: "warehouse-1",
      logistics: "Courier A",
      s_type: "Surface",
      order_type: "forward"
    });
    const shipment = (request.data.shipments as Array<Record<string, unknown>>)[0];
    expect(shipment).toMatchObject({ order: "TEST-SHP-000001", total_amount: "999.00", advance_amount: "999.00", cod_amount: "0", payment_mode: "Prepaid", return_address_id: "returns-1", store_id: "27377" });
    expect(request.data).not.toHaveProperty("store_id");
    expect(typeof shipment?.store_id).toBe("string");
    expect(request.data.pickup_address_id).not.toBe(shipment?.store_id);
  });

  it("fails locally before Add Order when Store ID is missing", async () => {
    Reflect.deleteProperty(mockedShippingConfig, "storeId");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.createShipment(createShipmentInput())).rejects.toMatchObject({ code: "NOT_CONFIGURED", message: "iThink store ID is not configured." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps tracking events from the official AWB response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: { AWB123: { message: "success", awb_no: "AWB123", logistic: "Courier A", current_status: "In Transit", current_status_code: "IT", scan_details: [{ status: "Picked Up", status_code: "PU", scan_location: "Chennai", remark: "Collected", scan_date_time: "2026-08-18 10:30:00" }] } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.track("AWB123")).resolves.toMatchObject({ awb: "AWB123", currentStatus: "In Transit", events: [{ status: "Picked Up", location: "Chennai", eventAt: "2026-08-18 10:30:00" }] });
    const request = sentRequest(fetchMock);
    expect(request.data).toMatchObject({ awb_number_list: "AWB123" });
    expect(request.data).not.toHaveProperty("store_id");
  });

  // Phase E.3 — a freshly-created/manifested AWB the courier hasn't scanned
  // yet is not a provider failure; see ithink.client.ts's track() comment.
  describe("Empty tracking data (AWB created, no scans yet)", () => {
    it("accepts a top-level empty array as a valid empty tracking response", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));
      await expect(IThinkClient.track("AWB123")).resolves.toEqual({ awb: "AWB123", courier: null, currentStatus: null, currentStatusCode: null, events: [] });
    });

    it("resolves with events=[] and no fabricated status when data is an empty array", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: [] })));
      await expect(IThinkClient.track("AWB123")).resolves.toEqual({ awb: "AWB123", courier: null, currentStatus: null, currentStatusCode: null, events: [] });
    });

    it("resolves with events=[] when data is an empty object (no entry for this AWB yet)", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: {} })));
      await expect(IThinkClient.track("AWB123")).resolves.toEqual({ awb: "AWB123", courier: null, currentStatus: null, currentStatusCode: null, events: [] });
    });

    it("still throws when data is empty but the top-level response reports a real rejection", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "error", data: [], message: "invalid awb" })));
      await expect(IThinkClient.track("AWB123")).rejects.toMatchObject({ code: "TRACKING_UNAVAILABLE" });
    });

    it("still throws when the response has no data key at all and reports an explicit error", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "error", message: "invalid awb" })));
      await expect(IThinkClient.track("AWB123")).rejects.toMatchObject({ code: "TRACKING_UNAVAILABLE" });
    });

    it("still throws INVALID_RESPONSE for a genuinely malformed/non-JSON body — real failures are never hidden", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("not json", { status: 200, headers: { "content-type": "text/html" } })));
      await expect(IThinkClient.track("AWB123")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("still throws INVALID_RESPONSE for an HTML body", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<!doctype html><html><body>Bad gateway</body></html>", { status: 200, headers: { "content-type": "text/html" } })));
      await expect(IThinkClient.track("AWB123")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("still throws INVALID_RESPONSE for an empty HTTP body", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200, headers: { "content-type": "application/json" } })));
      await expect(IThinkClient.track("AWB123")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("still throws INVALID_RESPONSE for an unexpected JSON primitive", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse("success")));
      await expect(IThinkClient.track("AWB123")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    });

    it("still throws PROVIDER_UNAVAILABLE for a real HTTP failure", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "error" }, 503)));
      await expect(IThinkClient.track("AWB123")).rejects.toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
    });
  });

  it("maps cancellation and NDR actions to their V3 endpoints", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ status: "success", data: { "1": { status: "success" } } }))
      .mockResolvedValueOnce(jsonResponse({ status: "success", data: { AWB123: { status: "success" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await IThinkClient.cancel("AWB123");
    await IThinkClient.ndr({ awb: "AWB123", action: 1, date: "2026-08-20", time: "14:00", phone: "9876543210", address: "Updated address" });
    expect((fetchMock.mock.calls[0] as [string])[0]).toContain("/api_v3/order/cancel.json");
    const secondBody = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body;
    if (typeof secondBody !== "string") throw new Error("Expected a JSON request body.");
    const second = JSON.parse(secondBody) as { data: { shipments: Array<Record<string, unknown>> } };
    expect((fetchMock.mock.calls[1] as [string])[0]).toContain("/api_v3/ndr/add-reattempt-rto.json");
    expect(second.data.shipments[0]).toMatchObject({ awb_numbers: "AWB123", ndr_action: "1", reattempt_date: "2026-08-20", reattempt_time: "14:00" });
  });

  it.each([
    ["top-level empty array", [], "INVALID_RESPONSE"],
    ["empty cancellation data", { status: "success", data: [] }, "CANCELLATION_REJECTED"],
    ["ambiguous cancellation result", { status: "success", data: { "1": { status: "pending" } } }, "CANCELLATION_REJECTED"]
  ] as const)("rejects a cancellation response with %s", async (_label, body, expectedCode) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
    await expect(IThinkClient.cancel("AWB123")).rejects.toMatchObject({ code: expectedCode });
  });

  it("distinguishes no-response uncertainty from an explicit provider rejection", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    await expect(IThinkClient.cancel("AWB123")).rejects.toMatchObject({ uncertain: true });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "error" }, 503)));
    await expect(IThinkClient.cancel("AWB123")).rejects.toMatchObject({ uncertain: false });
  });
});

describe.each([
  ["Manifested", "pickup_pending"], ["Picked Up", "picked_up"], ["In Transit", "in_transit"],
  ["Reached at Destination", "in_transit"], ["Out for Delivery", "out_for_delivery"], ["Undelivered", "ndr"],
  ["Not Picked", "delivery_exception"], ["Out of Delivery Area", "delivery_exception"], ["Delayed", "delivery_exception"],
  ["Damaged", "delivery_exception"], ["Misrouted", "delivery_exception"], ["Lost", "delivery_exception"],
  ["Shortage", "delivery_exception"], ["Delivered", "delivered"], ["Cancelled", "cancelled"],
  ["RTO Pending", "rto_initiated"], ["RTO Processing", "rto_initiated"], ["RTO In Transit", "rto_in_transit"],
  ["Reached at Origin", "rto_in_transit"], ["RTO Out for Delivery", "rto_in_transit"], ["RTO Undelivered", "rto_in_transit"],
  ["RTO Shortage", "rto_in_transit"], ["RTO Delivered", "rto_delivered"], ["new provider state", "provider_status_unknown"]
] as const)("provider status %s", (providerStatus, expected) => {
  it(`normalizes to ${expected}`, () => { expect(normalizeIThinkStatus(providerStatus)).toBe(expected); });
});

describe("shipment status monotonicity", () => {
  it("does not regress delivered shipments", () => { expect(canAdvanceShipmentStatus("delivered", "in_transit")).toBe(false); });
  it("does not regress an in-transit shipment to pickup", () => { expect(canAdvanceShipmentStatus("in_transit", "picked_up")).toBe(false); });
  it("allows a legitimate NDR reattempt", () => { expect(canAdvanceShipmentStatus("ndr", "out_for_delivery")).toBe(true); });
  it("allows entry into and completion of RTO", () => {
    expect(canAdvanceShipmentStatus("ndr", "rto_initiated")).toBe(true);
    expect(canAdvanceShipmentStatus("rto_initiated", "rto_delivered")).toBe(true);
  });
  it("stores unknown provider events without replacing the normalized shipment state", () => { expect(canAdvanceShipmentStatus("in_transit", "provider_status_unknown")).toBe(false); });
});

describe("ShipmentService fulfilment invariants", () => {
  const baseId = 990_000;
  let counter = 0;

  async function clean(): Promise<void> {
    await ShipmentTrackingEvent.destroy({ where: {}, force: true });
    await Shipment.destroy({ where: {}, force: true });
    await Replacement.destroy({ where: {}, force: true });
    await ReturnRequest.destroy({ where: {}, force: true });
    await ProductReview.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await ProductFeature.destroy({ where: {}, force: true });
    await ProductMediaAssignment.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    await User.destroy({ where: { id: baseId }, force: true });
  }

  async function createOrder(input: { paymentStatus?: "pending" | "paid"; status?: "confirmed" | "cancelled" | "delivered"; commerceException?: "inventory_unavailable" | null; userId?: number | null } = {}) {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const category = await Category.create({ id: baseId + counter * 10, name: `Shipping ${suffix}`, slug: `shipping-${suffix}`, description: "Shipping test", pet_type: "all", active: true, display_order: 1 });
    const product = await Product.create({ id: category.id + 1, category_id: category.id, name: `Shipping Product ${suffix}`, slug: `shipping-product-${suffix}`, sku: `SHIP-${suffix}`, description: "Shipping test", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 20, has_variants: false, featured: false, tags: null, meta_title: null, meta_description: null, weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00" });
    const order = await Order.create({ id: category.id + 2, order_number: `ORD-${suffix}`, user_id: input.userId ?? null, guest_identity_hash: null, guest_access_token_hash: null, cart_id: null, contact_email: "shipping@example.com", status: input.status ?? "confirmed", payment_status: input.paymentStatus ?? "paid", fulfilment_status: input.status === "delivered" ? "delivered" : "unfulfilled", commerce_exception: input.commerceException ?? null, subtotal: "1000.00", shipping_fee: "0.00", total: "1000.00", currency: "INR", ship_recipient_name: "Shipping Customer", ship_phone: "+91 98765 43210", ship_line_1: "10 Test Street", ship_line_2: null, ship_city: "Mumbai", ship_state: "Maharashtra", ship_postal_code: "400001", ship_country: "IN", ship_latitude: null, ship_longitude: null, placed_at: new Date("2026-08-18T08:00:00.000Z"), cancelled_at: input.status === "cancelled" ? new Date() : null });
    const item = await OrderItem.create({ id: category.id + 3, order_id: order.id, product_id: product.id, product_variant_id: null, product_name: product.name, product_sku: product.sku, variant_name: null, variant_sku: null, product_image: null, quantity: 2, unit_price: "500.00", line_total: "1000.00" });
    return { order, item, product };
  }

  function mockSuccessfulProvider() {
    vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
    vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
    return vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: `AWB-${counter}`, reference: `REF-${counter}`, courier: "Courier A", trackingUrl: null });
  }

  beforeAll(async () => { await connectDatabase(); });
  beforeEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await disconnectDatabase(); });

  it("creates one durable Shipment for an eligible paid Order and preserves the paid total", async () => {
    const { order } = await createOrder();
    const createSpy = mockSuccessfulProvider();
    const first = await ShipmentService.createForOrder(order.id);
    const second = await ShipmentService.createForOrder(order.id);
    expect(second.id).toBe(first.id);
    expect(createSpy).toHaveBeenCalledTimes(1);
    expect(first).toMatchObject({ sourceType: "order", sourceId: order.id, awbNumber: `AWB-${counter}`, providerCost: "87.50", shipmentNumber: `TEST-SHP-${String(first.id).padStart(6, "0")}` });
    expect(first.id).toBeGreaterThan(0);
    expect(first.awbNumber).not.toBe(first.shipmentNumber);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ orderNumber: first.shipmentNumber }));
    await order.reload();
    expect(order).toMatchObject({ payment_status: "paid", total: "1000.00", shipping_fee: "0.00", fulfilment_status: "processing" });
  });

  it("preserves a stored legacy shipment reference across reads and repeat creation", async () => {
    const { order } = await createOrder();
    const createSpy = mockSuccessfulProvider();
    const created = await ShipmentService.createForOrder(order.id);
    const legacyReference = `SHP-${String(created.id).padStart(6, "0")}`;
    await Shipment.update({ shipment_number: legacyReference }, { where: { id: created.id } });

    await expect(ShipmentService.getById(created.id)).resolves.toMatchObject({ id: created.id, shipmentNumber: legacyReference });
    await expect(ShipmentService.createForOrder(order.id)).resolves.toMatchObject({ id: created.id, shipmentNumber: legacyReference });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("keeps uniqueness on the complete stored shipment reference", () => {
    const numberIndex = Shipment.options.indexes?.find((index) => index.name === "shipments_number_unique");
    expect(numberIndex).toMatchObject({ unique: true, fields: ["shipment_number"] });
    expect("SHP-000006").not.toBe("TEST-SHP-000006");
  });

  it.each([
    [{ paymentStatus: "pending" } as const, "pending payment"],
    [{ status: "cancelled" } as const, "cancelled"],
    [{ commerceException: "inventory_unavailable" } as const, "commerce exception"]
  ])("rejects an ineligible Order with %s", async (overrides, _label) => {
    const { order } = await createOrder(overrides);
    const createSpy = mockSuccessfulProvider();
    await expect(ShipmentService.createForOrder(order.id)).rejects.toMatchObject({ code: "SHIPMENT_NOT_ELIGIBLE" });
    expect(await Shipment.count()).toBe(0);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("rejects shipment creation for a Product left with blank shipping measurements", async () => {
    // Product-level Create/Edit/Activation intentionally allows null shipping
    // measurements; ShipmentService must still fail clearly instead of
    // inventing fallback package dimensions. Reliability Phase 1A replaced
    // the old fail-on-first-item SHIPMENT_PACKAGE_DATA_INVALID with a single
    // pre-flight SHIPMENT_VALIDATION_FAILED that collects every missing
    // field (customer/address/package) into one message before any iThink
    // call — see ShipmentModels/shipment.service.ts's collectPackageLines.
    const { order, product } = await createOrder();
    await product.update({ weight_grams: null, length_cm: null, width_cm: null, height_cm: null });
    const createSpy = mockSuccessfulProvider();
    await expect(ShipmentService.createForOrder(order.id)).rejects.toMatchObject({ code: "SHIPMENT_VALIDATION_FAILED" });
    expect(await Shipment.count()).toBe(0);
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("collapses concurrent creation into one local and one provider shipment", async () => {
    const { order } = await createOrder();
    const createSpy = mockSuccessfulProvider();
    const results = await Promise.all([ShipmentService.createForOrder(order.id), ShipmentService.createForOrder(order.id)]);
    expect(results[0].id).toBe(results[1].id);
    expect(await Shipment.count()).toBe(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("quarantines an uncertain Add Order outcome and never retries it blindly", async () => {
    const { order } = await createOrder();
    vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
    vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
    const createSpy = vi.spyOn(IThinkClient, "createShipment").mockRejectedValue(new IThinkClientError("CREATE_UNCERTAIN", "timeout", true));
    await expect(ShipmentService.createForOrder(order.id)).rejects.toMatchObject({ code: "SHIPMENT_PROVIDER_STATUS_UNKNOWN" });
    await expect(ShipmentService.createForOrder(order.id)).resolves.toMatchObject({ status: "provider_status_unknown" });
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts an Add Order success that omits an AWB and flags it for reconciliation instead of failing", async () => {
    const { order } = await createOrder();
    vi.spyOn(IThinkClient, "checkServiceability").mockResolvedValue(["courier a"]);
    vi.spyOn(IThinkClient, "getRates").mockResolvedValue([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
    vi.spyOn(IThinkClient, "createShipment").mockResolvedValue({ awb: null, reference: "REF-NO-AWB", courier: "Courier A", trackingUrl: null });
    await expect(ShipmentService.createForOrder(order.id)).resolves.toMatchObject({ status: "provider_status_unknown", providerStatus: "Accepted without AWB; reconciliation required", awbNumber: null });
  });

  it("deduplicates tracking and provider-verifies Order delivery without touching Payment state", async () => {
    const { order } = await createOrder();
    mockSuccessfulProvider();
    const shipment = await ShipmentService.createForOrder(order.id);
    const tracking = { awb: shipment.awbNumber!, courier: "Courier A", currentStatus: "Delivered", currentStatusCode: "DL", events: [{ status: "Delivered", statusCode: "DL", location: "Mumbai", message: "Delivered", eventAt: "2026-08-20 12:00:00" }] };
    vi.spyOn(IThinkClient, "track").mockResolvedValue(tracking);
    await ShipmentService.refresh(shipment.id);
    await ShipmentService.refresh(shipment.id);
    expect(await ShipmentTrackingEvent.count({ where: { shipment_id: shipment.id } })).toBe(1);
    await order.reload();
    expect(order).toMatchObject({ status: "delivered", fulfilment_status: "delivered", payment_status: "paid" });
  });

  it("refresh succeeds without change when iThink reports no tracking data yet (AWB created, no scans)", async () => {
    const { order } = await createOrder();
    mockSuccessfulProvider();
    const shipment = await ShipmentService.createForOrder(order.id);
    vi.spyOn(IThinkClient, "track").mockResolvedValue({ awb: shipment.awbNumber!, courier: null, currentStatus: null, currentStatusCode: null, events: [] });

    const refreshed = await ShipmentService.refresh(shipment.id);

    expect(refreshed.status).toBe(shipment.status); // unchanged — "awb_assigned"
    expect(refreshed.providerStatus).toBe(shipment.providerStatus); // unchanged, not clobbered with a fabricated value
    expect(refreshed.lastSyncedAt).not.toBeNull();
    expect(await ShipmentTrackingEvent.count({ where: { shipment_id: shipment.id } })).toBe(0);
  });

  it("refreshes a shipment successfully when iThink returns a top-level empty array", async () => {
    const { order } = await createOrder();
    mockSuccessfulProvider();
    const shipment = await ShipmentService.createForOrder(order.id);
    const before = await ShipmentService.getById(shipment.id);
    await order.reload();
    const orderBefore = { status: order.status, fulfilment_status: order.fulfilment_status, payment_status: order.payment_status };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse([])));

    const refreshed = await ShipmentService.refresh(shipment.id);

    expect(refreshed.status).toBe(before.status);
    expect(refreshed.providerStatus).toBe(before.providerStatus);
    expect(refreshed.trackingEvents).toHaveLength(0);
    expect(refreshed.lastSyncedAt).not.toBeNull();
    await order.reload();
    expect(order).toMatchObject(orderBefore);
  });

  it("claims cancellation before the network call so concurrent clicks dispatch once", async () => {
    const { order } = await createOrder();
    mockSuccessfulProvider();
    const shipment = await ShipmentService.createForOrder(order.id);
    const cancelSpy = vi.spyOn(IThinkClient, "cancel").mockResolvedValue();
    const results = await Promise.all([ShipmentService.cancel(shipment.id), ShipmentService.cancel(shipment.id)]);
    expect(cancelSpy).toHaveBeenCalledTimes(1);
    expect(results.some((result) => result.status === "cancelled")).toBe(true);
    await expect(ShipmentService.cancel(shipment.id)).rejects.toMatchObject({ code: "SHIPMENT_ACTION_NOT_ALLOWED" });
  });

  it("makes a successful NDR reattempt idempotent across concurrent and repeated requests", async () => {
    const { order } = await createOrder();
    mockSuccessfulProvider();
    const shipment = await ShipmentService.createForOrder(order.id);
    await Shipment.update({ status: "ndr", provider_status: "Undelivered" }, { where: { id: shipment.id } });
    const ndrSpy = vi.spyOn(IThinkClient, "ndr").mockResolvedValue();
    await Promise.all([
      ShipmentService.reattempt(shipment.id, { date: "2026-08-22", time: "10:00:00" }),
      ShipmentService.reattempt(shipment.id, { date: "2026-08-22", time: "10:00:00" })
    ]);
    await ShipmentService.reattempt(shipment.id, { date: "2026-08-22", time: "10:00:00" });
    expect(ndrSpy).toHaveBeenCalledTimes(1);
    await expect(ShipmentService.getById(shipment.id)).resolves.toMatchObject({ status: "ndr", providerStatus: "Reattempt requested" });
  });

  it("claims RTO before dispatch and never changes the paid Order", async () => {
    const { order } = await createOrder();
    mockSuccessfulProvider();
    const shipment = await ShipmentService.createForOrder(order.id);
    await Shipment.update({ status: "delivery_exception", provider_status: "Delayed" }, { where: { id: shipment.id } });
    const ndrSpy = vi.spyOn(IThinkClient, "ndr").mockResolvedValue();
    await Promise.all([
      ShipmentService.requestRto(shipment.id, { reason: "Customer unavailable" }),
      ShipmentService.requestRto(shipment.id, { reason: "Customer unavailable" })
    ]);
    expect(ndrSpy).toHaveBeenCalledTimes(1);
    await expect(ShipmentService.getById(shipment.id)).resolves.toMatchObject({ status: "rto_initiated" });
    await order.reload();
    expect(order.payment_status).toBe("paid");
  });

  it("uses the same Shipment path and completes a Replacement only after delivery", async () => {
    await User.create({ id: baseId, reference_code: `USR-${baseId}`, role: "admin", status: "active", name: "Shipping Admin", email: "shipping-admin@example.com", phone: null, password_hash: "test", email_verified_at: null, last_login_at: null });
    const { order, item, product } = await createOrder({ status: "delivered", userId: baseId });
    const returnRequest = await ReturnRequest.create({ id: order.id + 10, return_number: `RET-${counter}`, order_id: order.id, order_item_id: item.id, quantity: 1, user_id: baseId, type: "replacement", status: "approved", reason: "Damaged", resolution_note: null, evidence_image_key: null, evidence_image_url: null, resolved_at: null });
    const replacement = await Replacement.create({ id: order.id + 11, replacement_number: `RPL-${counter}`, return_request_id: returnRequest.id, order_id: order.id, order_item_id: item.id, product_id: product.id, product_variant_id: null, quantity: 1, status: "processing", approved_by_admin_id: baseId, stock_consumed_at: new Date(), completed_at: null });
    mockSuccessfulProvider();
    const shipment = await ShipmentService.createForReplacement(replacement.id);
    expect(shipment).toMatchObject({ sourceType: "replacement", replacementId: replacement.id });
    await replacement.reload(); expect(replacement.status).toBe("processing");
    vi.spyOn(IThinkClient, "track").mockResolvedValue({ awb: shipment.awbNumber!, courier: "Courier A", currentStatus: "Delivered", currentStatusCode: "DL", events: [{ status: "Delivered", statusCode: "DL", location: "Mumbai", message: "Delivered", eventAt: "2026-08-21 12:00:00" }] });
    await ShipmentService.refresh(shipment.id);
    await replacement.reload(); await returnRequest.reload(); await order.reload();
    expect(replacement.status).toBe("completed");
    expect(returnRequest.status).toBe("resolved");
    expect(order.payment_status).toBe("paid");
  });
});
