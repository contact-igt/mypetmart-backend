import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/shipping.config.js", () => ({
  shippingConfig: {
    provider: "ithink",
    accessToken: "test-access-token",
    secretKey: "test-secret-key",
    apiBaseUrl: "https://pre-alpha.ithinklogistics.com",
    trackingBaseUrl: "https://pre-alpha.ithinklogistics.com",
    pickupAddressId: "warehouse-1",
    returnAddressId: "returns-1",
    originPincode: "600001",
    timeoutMs: 1_000,
    ready: true
  }
}));

import { IThinkClient, IThinkClientError } from "../../src/models/ShipmentModels/ithink.client.js";
import { canAdvanceShipmentStatus, normalizeIThinkStatus } from "../../src/models/ShipmentModels/shipment.service.js";
import { ShipmentService } from "../../src/models/ShipmentModels/shipment.service.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { Category, Order, OrderItem, Product, Replacement, ReturnRequest, Shipment, ShipmentTrackingEvent, User } from "../../src/database/tables/index.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function sentRequest(fetchMock: ReturnType<typeof vi.fn>): { url: string; data: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  if (typeof init.body !== "string") throw new Error("Expected a JSON request body.");
  return { url, data: (JSON.parse(init.body) as { data: Record<string, unknown> }).data };
}

describe("iThink Logistics V3 request contracts", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("maps serviceability to the official pincode endpoint and keeps only prepaid pickup couriers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: { "400001": { BlueDart: { prepaid: "Y", pickup: "Y" }, CodOnly: { prepaid: "N", pickup: "Y" } } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.checkServiceability("400001")).resolves.toEqual(["bluedart"]);
    const request = sentRequest(fetchMock);
    expect(request.url).toBe("https://pre-alpha.ithinklogistics.com/api_v3/pincode/check.json");
    expect(request.data).toMatchObject({ pincode: "400001", access_token: "test-access-token", secret_key: "test-secret-key" });
  });

  it("surfaces a provider-side serviceability rejection instead of treating it as no couriers", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "error", html_message: "Access Token Not Match." })));
    await expect(IThinkClient.checkServiceability("400001")).rejects.toMatchObject({ code: "SERVICEABILITY_CHECK_FAILED", message: "Access Token Not Match." });
  });

  it("maps rate inputs and accepts only prepaid pickup services", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: [
      { logistic_name: "Courier A", logistic_service_type: "Surface", prepaid: "Y", pickup: "Y", rate: "87.50" },
      { logistic_name: "Courier B", logistic_service_type: "Air", prepaid: "N", pickup: "Y", rate: "99.00" }
    ] }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.getRates({ toPincode: "400001", lengthCm: "10.00", widthCm: "8.00", heightCm: "6.00", weightKg: "0.500", productMrp: "999.00" })).resolves.toEqual([{ courier: "Courier A", serviceType: "Surface", rate: "87.50" }]);
    expect(sentRequest(fetchMock).data).toMatchObject({ from_pincode: "600001", to_pincode: "400001", shipping_weight_kg: "0.500", order_type: "forward", payment_method: "prepaid", delivery_type: "0" });
  });

  it("maps a forward prepaid shipment without changing the commerce total", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: { "1": { status: "success", waybill: "AWB123", refnum: "REF123", logistic_name: "Courier A", tracking_url: "https://track.example/AWB123" } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.createShipment({
      orderNumber: "ORD-1", orderDate: "2026-08-18", totalAmount: "999.00",
      recipient: { name: "Alex", address1: "Line 1", address2: "Line 2", pincode: "400001", city: "Mumbai", state: "Maharashtra", country: "India", phone: "9876543210", email: "alex@example.com" },
      products: [{ name: "Dog Food", sku: "DOG-1", quantity: 2, price: "499.50" }],
      lengthCm: "10.00", widthCm: "8.00", heightCm: "12.00", weightKg: "1.000", logistics: "Courier A", serviceType: "Surface"
    })).resolves.toMatchObject({ awb: "AWB123", reference: "REF123", courier: "Courier A" });
    const request = sentRequest(fetchMock);
    expect(request.url).toContain("/api_v3/order/add.json");
    expect(request.data).toMatchObject({ pickup_address_id: "warehouse-1", logistics: "Courier A", s_type: "Surface", order_type: "forward" });
    expect((request.data.shipments as Array<Record<string, unknown>>)[0]).toMatchObject({ order: "ORD-1", total_amount: "999.00", advance_amount: "999.00", cod_amount: "0", payment_mode: "Prepaid", return_address_id: "returns-1" });
  });

  it("maps tracking events from the official AWB response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "success", data: { AWB123: { message: "success", awb_no: "AWB123", logistic: "Courier A", current_status: "In Transit", current_status_code: "IT", scan_details: [{ status: "Picked Up", status_code: "PU", scan_location: "Chennai", remark: "Collected", scan_date_time: "2026-08-18 10:30:00" }] } } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(IThinkClient.track("AWB123")).resolves.toMatchObject({ awb: "AWB123", currentStatus: "In Transit", events: [{ status: "Picked Up", location: "Chennai", eventAt: "2026-08-18 10:30:00" }] });
    expect(sentRequest(fetchMock).data).toMatchObject({ awb_number_list: "AWB123" });
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
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
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
    expect(first).toMatchObject({ sourceType: "order", sourceId: order.id, awbNumber: `AWB-${counter}`, providerCost: "87.50" });
    await order.reload();
    expect(order).toMatchObject({ payment_status: "paid", total: "1000.00", shipping_fee: "0.00", fulfilment_status: "processing" });
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
