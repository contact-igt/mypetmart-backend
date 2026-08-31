/* eslint-disable */
import request from "supertest";
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

import { app } from "../../src/app.js";
import { IThinkClient, IThinkClientError } from "../../src/models/ShipmentModels/ithink.client.js";
import { ReturnShipmentService } from "../../src/models/ReturnShipmentModels/return-shipment.service.js";
import { ReturnService } from "../../src/models/ReturnModels/return.service.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { AuthSession, Category, Order, OrderItem, Payment, Product, Refund, ReturnRequest, ReturnShipment, ReturnShipmentTrackingEvent, User } from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

async function mintCustomerToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const user = await User.create({ id, name: `Return Shipment Customer ${id}`, email, password_hash: pwdHash, role: "customer", status: "active", reference_code: `CUS-${id}` });
  const { session } = await SessionService.createSession(user.id, "customer", null, null);
  return TokenService.generateAccessToken({ sub: String(user.id), sessionId: String(session.id), role: "customer", sessionType: "customer" });
}

async function mintAdminToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const admin = await User.create({ id, name: `Return Shipment Admin ${id}`, email, password_hash: pwdHash, role: "admin", status: "active", reference_code: `ADM-${id}` });
  const { session } = await SessionService.createSession(admin.id, "admin", null, null);
  return TokenService.generateAccessToken({ sub: String(admin.id), sessionId: String(session.id), role: "admin", sessionType: "admin" });
}

describe("ReturnShipmentService (Phase F.1)", () => {
  const baseId = 995_000;
  let counter = 0;

  async function clean(): Promise<void> {
    await ReturnShipmentTrackingEvent.destroy({ where: {}, force: true });
    await ReturnShipment.destroy({ where: {}, force: true });
    await Refund.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await ReturnRequest.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    await AuthSession.destroy({ where: { user_id: { [Op.gte]: baseId } }, force: true });
    await User.destroy({ where: { id: { [Op.gte]: baseId } }, force: true });
  }

  async function createApprovedReturn(overrides: { status?: "requested" | "approved" | "rejected" | "resolved" | "cancelled" } = {}) {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const id = baseId + counter * 100;
    const category = await Category.create({ id, name: `RS ${suffix}`, slug: `rs-${suffix}`, description: "Return shipment test", pet_type: "all", active: true, display_order: 1 });
    const product = await Product.create({ id: id + 1, category_id: category.id, name: `RS Product ${suffix}`, slug: `rs-product-${suffix}`, sku: `RS-${suffix}`, description: "Return shipment test", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 20, has_variants: false, featured: false, tags: null, meta_title: null, meta_description: null, weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00" });
    const order = await Order.create({
      id: id + 2, order_number: `ORD-${suffix}`, user_id: null, guest_identity_hash: null, guest_access_token_hash: null, cart_id: null,
      contact_email: "return-shipment@example.com", status: "return_requested", payment_status: "paid", fulfilment_status: "delivered", commerce_exception: null,
      subtotal: "1000.00", shipping_fee: "0.00", total: "1000.00", currency: "INR", ship_recipient_name: "Riya Sharma", ship_phone: "+91 98765 43210",
      ship_line_1: "10 MG Road", ship_line_2: null, ship_city: "Mumbai", ship_state: "Maharashtra", ship_postal_code: "400001", ship_country: "IN",
      ship_latitude: null, ship_longitude: null, placed_at: new Date("2026-08-10T08:00:00.000Z"), cancelled_at: null
    });
    const item = await OrderItem.create({ id: id + 3, order_id: order.id, product_id: product.id, product_variant_id: null, product_name: product.name, product_sku: product.sku, variant_name: null, variant_sku: null, product_image: null, quantity: 2, unit_price: "500.00", line_total: "1000.00" });
    const pwdHash = await PasswordService.hash("TestPass123!@#");
    const user = await User.create({ id: id + 5, name: "Riya Sharma", email: `rs-owner-${suffix}@example.com`, password_hash: pwdHash, role: "customer", status: "active", reference_code: `CUS-${id + 5}` });
    const returnRequest = await ReturnRequest.create({
      id: id + 4, return_number: `RET-${suffix}`, order_id: order.id, order_item_id: item.id, quantity: 1, user_id: user.id,
      type: "return", status: overrides.status ?? "approved", reason: "Damaged", resolution_note: null, evidence_image_key: null, evidence_image_url: null
    });
    return { order, item, returnRequest };
  }

  async function createRefund(returnRequest: ReturnRequest, status: "pending" | "processing" | "succeeded" | "failed") {
    const payment = await Payment.create({
      id: returnRequest.id + 6,
      order_id: returnRequest.order_id,
      provider: "payu",
      provider_order_id: `PAY-${returnRequest.id}`,
      provider_payment_id: `PAYMENT-${returnRequest.id}`,
      status: "paid",
      amount: "1000.00",
      currency: "INR",
      method: "card",
      paid_at: new Date(),
      failed_at: null,
      refunded_at: null,
      raw_payload: null
    });
    return Refund.create({
      id: returnRequest.id + 7,
      refund_number: `RFD-${returnRequest.id}`,
      order_id: returnRequest.order_id,
      payment_id: payment.id,
      return_request_id: returnRequest.id,
      provider: "payu",
      provider_refund_token: `REFUND-TOKEN-${returnRequest.id}`,
      provider_request_id: null,
      provider_refund_id: status === "succeeded" ? `PROVIDER-REFUND-${returnRequest.id}` : null,
      provider_status: null,
      status,
      amount: "500.00",
      currency: "INR",
      failure_code: null,
      failure_message: null,
      initiated_by_admin_id: returnRequest.user_id,
      initiated_at: new Date(),
      completed_at: status === "succeeded" ? new Date() : null,
      failed_at: status === "failed" ? new Date() : null,
      raw_payload: null
    });
  }

  function mockSuccessfulProvider() {
    vi.spyOn(IThinkClient, "getReverseRates").mockResolvedValue([{ courier: "Delhivery", serviceType: "Surface", rate: "80.00", deliveryTat: 4, estimatedDelivery: null }]);
    return vi.spyOn(IThinkClient, "createReverseShipment").mockResolvedValue({ awb: `RAWB-${counter}`, reference: `RREF-${counter}`, courier: "Delhivery", trackingUrl: "https://track.example/RAWB" });
  }

  beforeAll(async () => { await connectDatabase(); });
  beforeEach(async () => { vi.restoreAllMocks(); await clean(); });
  afterAll(async () => { await clean(); await disconnectDatabase(); });

  describe("Return Shipment Creation", () => {
    it("creates a return shipment for an approved return", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      const createSpy = mockSuccessfulProvider();

      const result = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);

      expect(result).toMatchObject({ returnRequestId: returnRequest.id, status: "approved", carrier: "Delhivery", awbNumber: `RAWB-${counter}` });
      expect(result.shipmentNumber).toMatch(/^RSH-\d{6}$/);
      expect(createSpy).toHaveBeenCalledTimes(1);
    });

    it("rejects creation for a return that is not yet approved", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "requested" });
      const createSpy = mockSuccessfulProvider();

      await expect(ReturnShipmentService.createForApprovedReturn(returnRequest.id)).rejects.toMatchObject({ code: "RETURN_SHIPMENT_NOT_ELIGIBLE" });
      expect(createSpy).not.toHaveBeenCalled();
      expect(await ReturnShipment.count()).toBe(0);
    });

    it("rejects creation for a rejected return", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "rejected" });
      await expect(ReturnShipmentService.createForApprovedReturn(returnRequest.id)).rejects.toMatchObject({ code: "RETURN_SHIPMENT_NOT_ELIGIBLE" });
    });

    it("prevents duplicate creation for the same return request", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();

      const first = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      await expect(ReturnShipmentService.createForApprovedReturn(returnRequest.id)).rejects.toMatchObject({ code: "RETURN_SHIPMENT_ALREADY_EXISTS" });
      expect(await ReturnShipment.count({ where: { return_request_id: returnRequest.id } })).toBe(1);
      expect(first.id).toBeGreaterThan(0);
    });

    it("rejects a non-existent return request", async () => {
      await expect(ReturnShipmentService.createForApprovedReturn(999_999_999)).rejects.toMatchObject({ code: "RETURN_SHIPMENT_NOT_FOUND" });
    });
  });

  describe("Courier interaction", () => {
    it("stores the AWB and tracking URL from a successful iThink booking", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();

      const result = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);

      expect(result.awbNumber).toBe(`RAWB-${counter}`);
      expect(result.trackingUrl).toBe("https://track.example/RAWB");
      expect(result.status).toBe("approved");
    });

    it("marks the return shipment failed and surfaces the real remark on a courier rejection", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      vi.spyOn(IThinkClient, "getReverseRates").mockResolvedValue([{ courier: "Delhivery", serviceType: "Surface", rate: "80.00", deliveryTat: 4, estimatedDelivery: null }]);
      vi.spyOn(IThinkClient, "createReverseShipment").mockRejectedValue(new IThinkClientError("CREATE_REJECTED", "Pickup address invalid"));

      await expect(ReturnShipmentService.createForApprovedReturn(returnRequest.id)).rejects.toMatchObject({ code: "ITHINK_CREATE_REJECTED" });

      const shipment = await ReturnShipmentService.getForReturnRequest(returnRequest.id);
      expect(shipment?.status).toBe("failed");
      expect(shipment?.failureReason).toMatchObject({ errorCode: "CREATE_REJECTED", message: "Pickup address invalid" });
    });

    it("fails cleanly when no reverse-capable courier is serviceable", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      vi.spyOn(IThinkClient, "getReverseRates").mockResolvedValue([]);
      const createSpy = vi.spyOn(IThinkClient, "createReverseShipment");

      await expect(ReturnShipmentService.createForApprovedReturn(returnRequest.id)).rejects.toMatchObject({ code: "RETURN_SHIPMENT_DESTINATION_UNSERVICEABLE" });
      expect(createSpy).not.toHaveBeenCalled();
      const shipment = await ReturnShipmentService.getForReturnRequest(returnRequest.id);
      expect(shipment?.status).toBe("failed");
    });

    it("allows retrying after a failed booking (not blocked as a duplicate)", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      vi.spyOn(IThinkClient, "getReverseRates").mockResolvedValue([{ courier: "Delhivery", serviceType: "Surface", rate: "80.00", deliveryTat: 4, estimatedDelivery: null }]);
      vi.spyOn(IThinkClient, "createReverseShipment").mockRejectedValueOnce(new IThinkClientError("CREATE_REJECTED", "temporary"));
      await expect(ReturnShipmentService.createForApprovedReturn(returnRequest.id)).rejects.toBeDefined();

      vi.spyOn(IThinkClient, "createReverseShipment").mockResolvedValue({ awb: "RAWB-RETRY", reference: "RREF-RETRY", courier: "Delhivery", trackingUrl: null });
      const retried = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);

      expect(retried.status).toBe("approved");
      expect(retried.awbNumber).toBe("RAWB-RETRY");
      expect(await ReturnShipment.count({ where: { return_request_id: returnRequest.id } })).toBe(1);
    });
  });

  describe("Tracking sync", () => {
    it("advances status and records a pickup event without touching ReturnRequest.item_received_at", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);

      vi.spyOn(IThinkClient, "track").mockResolvedValue({ awb: shipment.awbNumber!, courier: "Delhivery", currentStatus: "Picked Up", currentStatusCode: "PU", events: [{ status: "Picked Up", statusCode: "PU", location: "Mumbai", message: "Collected", eventAt: "2026-08-20 10:00:00" }] });
      await ReturnShipmentService.refresh(shipment.id);

      const refreshed = await ReturnShipmentService.getById(shipment.id);
      expect(refreshed.status).toBe("picked_up");
      expect(refreshed.trackingEvents).toHaveLength(1);
      expect(refreshed.trackingEvents[0]).toMatchObject({ status: "picked_up", location: "Mumbai" });

      await returnRequest.reload();
      expect(returnRequest.item_received_at).toBeNull();
    });

    it("advances to delivered on a courier delivery scan, still without auto-marking the item received", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);

      vi.spyOn(IThinkClient, "track").mockResolvedValue({ awb: shipment.awbNumber!, courier: "Delhivery", currentStatus: "Delivered", currentStatusCode: "DL", events: [{ status: "Delivered", statusCode: "DL", location: "Warehouse", message: null, eventAt: "2026-08-22 10:00:00" }] });
      await ReturnShipmentService.refresh(shipment.id);

      const refreshed = await ReturnShipmentService.getById(shipment.id);
      expect(refreshed.status).toBe("delivered");
      expect(refreshed.deliveredAt).toBeTruthy();

      await returnRequest.reload();
      expect(returnRequest.item_received_at).toBeNull();
      expect(returnRequest.status).toBe("approved"); // refund flow untouched — still requires separate admin action
    });

    it("deduplicates repeated tracking syncs", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);

      const tracking = { awb: shipment.awbNumber!, courier: "Delhivery", currentStatus: "In Transit", currentStatusCode: "IT", events: [{ status: "In Transit", statusCode: "IT", location: "Hub", message: null, eventAt: "2026-08-21 10:00:00" }] };
      vi.spyOn(IThinkClient, "track").mockResolvedValue(tracking);
      await ReturnShipmentService.refresh(shipment.id);
      await ReturnShipmentService.refresh(shipment.id);

      expect(await ReturnShipmentTrackingEvent.count({ where: { return_shipment_id: shipment.id } })).toBe(1);
    });

    it("refreshes a return shipment successfully when iThink returns a top-level empty array", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      const before = await ReturnShipmentService.getById(shipment.id);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 200, headers: { "content-type": "application/json" } })));

      const refreshed = await ReturnShipmentService.refresh(shipment.id);

      expect(refreshed.status).toBe(before.status);
      expect(refreshed.providerStatus).toBe(before.providerStatus);
      expect(refreshed.trackingEvents).toHaveLength(0);
      expect(refreshed.lastSyncedAt).not.toBeNull();
    });
  });

  describe("Admin tracking refresh", () => {
    it("requires authentication", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);

      const res = await request(app).post(`/api/v1/admin/return-shipments/${shipment.id}/refresh`);

      expect(res.status).toBe(401);
    });

    it("rejects a customer token", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      const customerToken = await mintCustomerToken(baseId + 10, "rs-refresh-customer@example.com");

      const res = await request(app)
        .post(`/api/v1/admin/return-shipments/${shipment.id}/refresh`)
        .set("Authorization", `Bearer ${customerToken}`);

      expect([401, 403]).toContain(res.status);
    });

    it("refreshes through the Admin endpoint without creating another shipment", async () => {
      const { order, returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      const adminToken = await mintAdminToken(baseId + 11, "rs-refresh-admin@example.com");
      vi.spyOn(IThinkClient, "track").mockResolvedValue({
        awb: shipment.awbNumber!, courier: "Delhivery", currentStatus: "Picked Up", currentStatusCode: "PU",
        events: [{ status: "Picked Up", statusCode: "PU", location: "Mumbai", message: "Collected", eventAt: "2026-08-20 10:00:00" }]
      });

      const res = await request(app)
        .post(`/api/v1/admin/return-shipments/${shipment.id}/refresh`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: shipment.id, status: "picked_up", awbNumber: shipment.awbNumber, providerStatusCode: "PU" });
      expect(await ReturnShipment.count({ where: { return_request_id: returnRequest.id } })).toBe(1);
      await order.reload();
      expect(order.status).toBe("return_requested");
      expect(order.payment_status).toBe("paid");
    });

    it("accepts an empty tracking response without fabricating state", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      const before = await ReturnShipmentService.getById(shipment.id);
      const adminToken = await mintAdminToken(baseId + 12, "rs-empty-admin@example.com");
      vi.spyOn(IThinkClient, "track").mockResolvedValue({ awb: shipment.awbNumber!, courier: null, currentStatus: null, currentStatusCode: null, events: [] });

      const res = await request(app)
        .post(`/api/v1/admin/return-shipments/${shipment.id}/refresh`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: shipment.id, status: before.status, providerStatus: before.providerStatus, trackingEvents: [] });
      expect(res.body.data.lastSyncedAt).not.toBeNull();
    });

    it("rejects refresh when no AWB is assigned", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      await ReturnShipment.update({ awb_number: null }, { where: { id: shipment.id } });
      const adminToken = await mintAdminToken(baseId + 13, "rs-no-awb-admin@example.com");
      const trackSpy = vi.spyOn(IThinkClient, "track");

      const res = await request(app)
        .post(`/api/v1/admin/return-shipments/${shipment.id}/refresh`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("RETURN_SHIPMENT_ACTION_NOT_ALLOWED");
      expect(trackSpy).not.toHaveBeenCalled();
    });

    it("does not regress a terminal return shipment", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      await ReturnShipment.update({ status: "delivered" }, { where: { id: shipment.id } });
      const adminToken = await mintAdminToken(baseId + 14, "rs-terminal-admin@example.com");
      vi.spyOn(IThinkClient, "track").mockResolvedValue({ awb: shipment.awbNumber!, courier: "Delhivery", currentStatus: "Picked Up", currentStatusCode: "PU", events: [] });

      const res = await request(app)
        .post(`/api/v1/admin/return-shipments/${shipment.id}/refresh`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("delivered");
    });
  });

  describe("Return cancellation", () => {
    it("requires authentication and ownership on the customer cancellation endpoint", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "requested" });
      const unauthenticated = await request(app).post(`/api/v1/storefront/returns/${returnRequest.id}/cancel`).send({});
      expect(unauthenticated.status).toBe(401);

      const otherCustomer = await mintCustomerToken(baseId + 30, "rs-other-customer@example.com");
      const forbidden = await request(app)
        .post(`/api/v1/storefront/returns/${returnRequest.id}/cancel`)
        .set("Authorization", `Bearer ${otherCustomer}`)
        .send({});
      expect(forbidden.status).toBe(404);
      expect((await ReturnRequest.findByPk(returnRequest.id))?.status).toBe("requested");
    });

    it("cancels a return with no reverse shipment without changing order or payment state", async () => {
      const { order, returnRequest } = await createApprovedReturn({ status: "approved" });
      const before = { status: order.status, fulfilment_status: order.fulfilment_status, payment_status: order.payment_status };
      const admin = await mintAdminToken(baseId + 20, "rs-cancel-admin@example.com");
      const res = await request(app).post(`/api/v1/admin/returns/${returnRequest.id}/cancel`).set("Authorization", `Bearer ${admin}`).send({ reason: "Customer changed their mind" });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: "cancelled", cancellationReason: "Customer changed their mind", cancellationSource: "admin" });
      await order.reload();
      await returnRequest.reload();
      expect(order).toMatchObject(before);
      expect(returnRequest.status).toBe("cancelled");
      expect(await Refund.count({ where: { return_request_id: returnRequest.id } })).toBe(0);
      expect(await ReturnShipment.count()).toBe(0);
    });

    it.each(["requested", "approved"] as const)("allows an eligible %s return with no shipment", async (status) => {
      const { returnRequest } = await createApprovedReturn({ status });
      expect((await ReturnService.getAdminReturn(returnRequest.id)).canCancel).toBe(true);
      await expect(ReturnService.cancelAdminReturn(returnRequest.user_id, returnRequest.id)).resolves.toMatchObject({ status: "cancelled", canCancel: false });
    });

    it.each(["rejected", "resolved"] as const)("blocks a %s return", async (status) => {
      const { returnRequest } = await createApprovedReturn({ status });
      expect((await ReturnService.getAdminReturn(returnRequest.id)).canCancel).toBe(false);
      await expect(ReturnService.cancelAdminReturn(baseId + 32, returnRequest.id)).rejects.toMatchObject({ code: "RETURN_CANCELLATION_NOT_ALLOWED" });
    });

    it.each(["processing", "succeeded"] as const)("blocks cancellation when a %s refund exists", async (status) => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      await createRefund(returnRequest, status);
      expect((await ReturnService.getAdminReturn(returnRequest.id)).canCancel).toBe(false);
      await expect(ReturnService.cancelAdminReturn(baseId + 33, returnRequest.id)).rejects.toMatchObject({ code: "RETURN_CANCELLATION_NOT_ALLOWED" });
      expect((await ReturnRequest.findByPk(returnRequest.id))?.status).toBe("approved");
    });

    it("allows local cancellation for a shipment without an AWB", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      await ReturnShipment.update({ awb_number: null }, { where: { id: shipment.id } });
      const cancelSpy = vi.spyOn(IThinkClient, "cancel");

      expect((await ReturnService.getAdminReturn(returnRequest.id)).canCancel).toBe(true);
      await expect(ReturnService.cancelAdminReturn(returnRequest.user_id, returnRequest.id)).resolves.toMatchObject({ status: "cancelled" });
      expect(cancelSpy).not.toHaveBeenCalled();
      expect((await ReturnShipment.findByPk(shipment.id))?.status).toBe("approved");
    });

    it("treats an already-cancelled return as an idempotent success", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "cancelled" });
      const cancelSpy = vi.spyOn(IThinkClient, "cancel");

      await expect(ReturnService.cancelAdminReturn(returnRequest.user_id, returnRequest.id)).resolves.toMatchObject({ status: "cancelled", canCancel: false });
      expect(cancelSpy).not.toHaveBeenCalled();
    });

    it("allows the owning customer to cancel an open return", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "requested" });
      const { session } = await SessionService.createSession(returnRequest.user_id, "customer", null, null);
      const customer = TokenService.generateAccessToken({ sub: String(returnRequest.user_id), sessionId: String(session.id), role: "customer", sessionType: "customer" });
      const res = await request(app).post(`/api/v1/storefront/returns/${returnRequest.id}/cancel`).set("Authorization", `Bearer ${customer}`).send({ reason: "No longer needed" });
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ status: "cancelled", cancellationSource: "customer" });
    });

    it("cancels a pre-pickup reverse shipment exactly once", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      const cancelSpy = vi.spyOn(IThinkClient, "cancel").mockResolvedValue();
      const admin = await mintAdminToken(baseId + 21, "rs-cancel-provider-admin@example.com");
      const first = await request(app).post(`/api/v1/admin/returns/${returnRequest.id}/cancel`).set("Authorization", `Bearer ${admin}`).send({});
      const second = await request(app).post(`/api/v1/admin/returns/${returnRequest.id}/cancel`).set("Authorization", `Bearer ${admin}`).send({});
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(cancelSpy).toHaveBeenCalledWith(shipment.awbNumber);
      expect((await ReturnShipment.findByPk(shipment.id))?.status).toBe("cancelled");
      expect((await ReturnRequest.findByPk(returnRequest.id))?.status).toBe("cancelled");
    });

    it("rolls back local state when the provider rejects cancellation", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      vi.spyOn(IThinkClient, "cancel").mockRejectedValue(new IThinkClientError("CANCELLATION_REJECTED", "AWB cannot be cancelled"));
      await expect(ReturnService.cancelAdminReturn(baseId + 22, returnRequest.id)).rejects.toMatchObject({ code: "RETURN_CANCELLATION_PROVIDER_ERROR" });
      expect((await ReturnRequest.findByPk(returnRequest.id))?.status).toBe("approved");
      expect((await ReturnShipment.findByPk(shipment.id))?.status).toBe("approved");
    });

    it.each([
      ["malformed", "<html><body>Bad gateway</body></html>", "text/html"],
      ["empty", "[]", "application/json"],
      ["ambiguous", JSON.stringify({ status: "success", data: { "1": { status: "pending" } } }), "application/json"]
    ] as const)("rolls back local state for a provider %s response", async (_kind, body, contentType) => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 200, headers: { "content-type": contentType } })));

      await expect(ReturnService.cancelAdminReturn(baseId + 35, returnRequest.id)).rejects.toMatchObject({ code: "RETURN_CANCELLATION_PROVIDER_ERROR" });
      expect((await ReturnRequest.findByPk(returnRequest.id))?.status).toBe("approved");
      expect((await ReturnShipment.findByPk(shipment.id))?.status).toBe("approved");
    });

    it.each([
      ["pickup_scheduled", "REV Manifested", true],
      ["picked_up", "REV Picked Up", false],
      ["in_transit", "REV In Transit", false],
      ["in_transit", "REV Out For Delivery", false],
      ["delivered", "Delivered", false],
      ["delivered", "REV Closed", false],
      ["failed", "REV Failed", false],
      ["pending", "REV Unknown", false]
    ] as const)("applies the cancellation rule for %s / %s", async (localStatus, providerStatus, expectedAllowed = false) => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      await ReturnShipment.update({ status: localStatus, provider_status: providerStatus }, { where: { id: shipment.id } });
      const cancelSpy = vi.spyOn(IThinkClient, "cancel").mockResolvedValue();
      expect((await ReturnService.getAdminReturn(returnRequest.id)).canCancel).toBe(expectedAllowed);
      if (expectedAllowed) {
        await expect(ReturnService.cancelAdminReturn(returnRequest.user_id, returnRequest.id)).resolves.toMatchObject({ status: "cancelled" });
        expect(cancelSpy).toHaveBeenCalledTimes(1);
      } else {
        await expect(ReturnService.cancelAdminReturn(baseId + 36, returnRequest.id)).rejects.toMatchObject({ code: "RETURN_CANCELLATION_NOT_ALLOWED" });
        expect(cancelSpy).not.toHaveBeenCalled();
        expect((await ReturnRequest.findByPk(returnRequest.id))?.status).toBe("approved");
      }
    });

    it("syncs a provider-already-cancelled reverse shipment without calling iThink", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      await ReturnShipment.update({ provider_status: "REV Cancelled" }, { where: { id: shipment.id } });
      const cancelSpy = vi.spyOn(IThinkClient, "cancel");
      await ReturnService.cancelAdminReturn(returnRequest.user_id, returnRequest.id);
      expect(cancelSpy).not.toHaveBeenCalled();
      expect((await ReturnShipment.findByPk(shipment.id))?.status).toBe("cancelled");
      expect((await ReturnShipment.findByPk(shipment.id))?.cancelled_at).not.toBeNull();
      expect((await ReturnRequest.findByPk(returnRequest.id))?.status).toBe("cancelled");
    });

    it("keeps cancellation idempotent and preserves reverse tracking history", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      await ReturnShipmentTrackingEvent.create({
        id: shipment.id + 100,
        return_shipment_id: shipment.id,
        dedupe_key: `history-${shipment.id}`,
        provider_status: "Manifested",
        provider_status_code: "MF",
        normalized_status: "pickup_scheduled",
        location: "Mumbai",
        message: "Manifested",
        event_at: new Date()
      });
      const cancelSpy = vi.spyOn(IThinkClient, "cancel").mockResolvedValue();
      await ReturnService.cancelAdminReturn(returnRequest.user_id, returnRequest.id);
      await ReturnService.cancelAdminReturn(returnRequest.user_id, returnRequest.id);

      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect(await ReturnShipmentTrackingEvent.count({ where: { return_shipment_id: shipment.id } })).toBe(1);
      expect(await ReturnShipment.count({ where: { return_request_id: returnRequest.id } })).toBe(1);
    });

    it("serializes customer and admin cancellation to one provider call", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const shipment = await ReturnShipmentService.createForApprovedReturn(returnRequest.id);
      const cancelSpy = vi.spyOn(IThinkClient, "cancel").mockImplementation(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const { session } = await SessionService.createSession(returnRequest.user_id, "customer", null, null);
      const customer = TokenService.generateAccessToken({ sub: String(returnRequest.user_id), sessionId: String(session.id), role: "customer", sessionType: "customer" });
      const admin = await mintAdminToken(baseId + 38, "rs-concurrent-admin@example.com");

      const [customerResult, adminResult] = await Promise.all([
        request(app).post(`/api/v1/storefront/returns/${returnRequest.id}/cancel`).set("Authorization", `Bearer ${customer}`).send({}),
        request(app).post(`/api/v1/admin/returns/${returnRequest.id}/cancel`).set("Authorization", `Bearer ${admin}`).send({})
      ]);

      expect([customerResult.status, adminResult.status].every((status) => status === 200)).toBe(true);
      expect(cancelSpy).toHaveBeenCalledTimes(1);
      expect((await ReturnRequest.findByPk(returnRequest.id))?.status).toBe("cancelled");
      expect((await ReturnShipment.findByPk(shipment.id))?.status).toBe("cancelled");
    });
  });

  describe("Security — admin-only creation", () => {
    it("rejects an unauthenticated request to create a return shipment", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      const res = await request(app).post(`/api/v1/admin/returns/${returnRequest.id}/create-shipment`);
      expect(res.status).toBe(401);
    });

    it("rejects a customer (non-admin) token from creating a return shipment", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      const customerToken = await mintCustomerToken(baseId + 1, "rs-customer@example.com");

      const res = await request(app).post(`/api/v1/admin/returns/${returnRequest.id}/create-shipment`).set("Authorization", `Bearer ${customerToken}`);

      expect([401, 403]).toContain(res.status);
      expect(await ReturnShipment.count({ where: { return_request_id: returnRequest.id } })).toBe(0);
    });

    it("allows an admin token to create a return shipment", async () => {
      const { returnRequest } = await createApprovedReturn({ status: "approved" });
      mockSuccessfulProvider();
      const adminToken = await mintAdminToken(baseId + 2, "rs-admin@example.com");

      const res = await request(app).post(`/api/v1/admin/returns/${returnRequest.id}/create-shipment`).set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.data).toMatchObject({ returnRequestId: returnRequest.id, carrier: "Delhivery" });
    });
  });
});
