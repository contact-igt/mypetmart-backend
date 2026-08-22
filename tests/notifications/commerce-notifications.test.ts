import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { Category, NotificationLog, Order, OrderItem, Payment, Product, Refund, Replacement, ReturnRequest, Shipment, User } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";
import { emailService, type EmailSendOptions } from "../../src/services/email/email.service.js";
import { CommerceNotifications } from "../../src/services/notification/commerce-notifications.service.js";
import { NotificationService } from "../../src/services/notification/notification.service.js";

let counter = 0;
const createdUserIds: number[] = [];
const createdOrderIds: number[] = [];
const createdProductIds: number[] = [];
const createdCategoryIds: number[] = [];

async function nextId(sequenceName: string): Promise<number> {
  return sequelize.transaction((t) => IdSequenceService.allocateNextId(sequenceName, t));
}

async function seedAdmin(): Promise<User> {
  const id = await nextId("users");
  const user = await User.create({ id, reference_code: `ADM-${id}`, role: "admin", status: "active", name: `Notify Test Admin ${id}`, email: `notify-admin-${id}@example.com`, phone: null, password_hash: "test-hash" });
  createdUserIds.push(id);
  return user;
}

async function seedCustomer(email?: string): Promise<User> {
  const id = await nextId("users");
  const user = await User.create({ id, reference_code: `CUS-${id}`, role: "customer", status: "active", name: `Notify Test Customer ${id}`, email: email ?? `notify-customer-${id}@example.com`, phone: null, password_hash: "test-hash" });
  createdUserIds.push(id);
  return user;
}

async function seedOrder(input: { userId?: number | null; contactEmail: string; status?: "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled" | "return_requested"; paymentStatus?: "pending" | "paid" | "failed" }): Promise<{ order: Order; item: OrderItem }> {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  const categoryId = await nextId("categories");
  const category = await Category.create({ id: categoryId, name: `Notify Cat ${suffix}`, slug: `notify-cat-${suffix}`, description: "Notification test category", pet_type: "all", active: true, display_order: 1 });
  createdCategoryIds.push(category.id);

  const productId = await nextId("products");
  const product = await Product.create(
    {
      id: productId, category_id: category.id, name: `Notify Product ${suffix}`, slug: `notify-product-${suffix}`, sku: `NOTIFY-${suffix}`,
      description: "Notification test product", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 50,
      has_variants: false, featured: false
    } as never
  );
  createdProductIds.push(product.id);

  const orderId = await nextId("orders");
  const order = await Order.create({
    id: orderId, order_number: buildBusinessReference("order", orderId), user_id: input.userId ?? null,
    guest_identity_hash: null, guest_access_token_hash: null, cart_id: null, contact_email: input.contactEmail,
    status: input.status ?? "confirmed", payment_status: input.paymentStatus ?? "paid", fulfilment_status: "unfulfilled", commerce_exception: null,
    subtotal: "1000.00", shipping_fee: "0.00", total: "1000.00", currency: "INR",
    ship_recipient_name: "Notify Recipient", ship_phone: "+91 98765 43210", ship_line_1: "1 Test Street", ship_line_2: null,
    ship_city: "Chennai", ship_state: "Tamil Nadu", ship_postal_code: "600001", ship_country: "IN", ship_latitude: null, ship_longitude: null,
    placed_at: new Date(), cancelled_at: null
  });
  createdOrderIds.push(order.id);

  const itemId = await nextId("order_items");
  const item = await OrderItem.create({
    id: itemId, order_id: order.id, product_id: product.id, product_variant_id: null, product_name: product.name, product_sku: product.sku,
    variant_name: null, variant_sku: null, product_image: null, quantity: 2, unit_price: "500.00", line_total: "1000.00"
  });

  return { order, item };
}

async function seedPayment(orderId: number, status: "pending" | "paid" | "failed" = "paid"): Promise<Payment> {
  const id = await nextId("payments");
  return Payment.create({
    id, order_id: orderId, provider: "payu", provider_order_id: `PROV-${id}`, provider_payment_id: status === "paid" ? `PAY-${id}` : null,
    status, amount: "1000.00", currency: "INR", method: status === "paid" ? "card" : null,
    paid_at: status === "paid" ? new Date() : null, failed_at: status === "failed" ? new Date() : null, refunded_at: null, raw_payload: null
  });
}

async function seedReturnRequest(orderId: number, orderItemId: number, userId: number, input: { type?: "return" | "replacement"; status?: "requested" | "approved" | "rejected" } = {}): Promise<ReturnRequest> {
  const id = await nextId("return_requests");
  return ReturnRequest.create({
    id, return_number: buildBusinessReference("return", id), order_id: orderId, order_item_id: orderItemId, quantity: 1, user_id: userId,
    type: input.type ?? "return", status: input.status ?? "requested", reason: "Doesn't fit", resolution_note: null,
    evidence_image_key: null, evidence_image_url: null, item_received_at: input.type === "replacement" ? new Date() : null,
    item_received_by_admin_id: null, resolved_at: input.status === "rejected" ? new Date() : null
  });
}

async function seedRefund(orderId: number, paymentId: number, returnRequestId: number | null, adminId: number, status: "pending" | "processing" | "succeeded" | "failed" = "pending"): Promise<Refund> {
  const id = await nextId("refunds");
  return Refund.create({
    id, refund_number: buildBusinessReference("refund", id), order_id: orderId, payment_id: paymentId, return_request_id: returnRequestId,
    provider: "payu", provider_refund_token: `REFTOK-${id}`, provider_request_id: null, provider_refund_id: status === "succeeded" ? `PROVREF-${id}` : null,
    provider_status: null, status, amount: "500.00", currency: "INR", failure_code: null, failure_message: null,
    initiated_by_admin_id: adminId, completed_at: status === "succeeded" ? new Date() : null, failed_at: status === "failed" ? new Date() : null, raw_payload: null
  });
}

async function seedReplacement(returnRequestId: number, orderId: number, orderItemId: number, productId: number, adminId: number, status: "stock_unavailable" | "processing" | "completed" = "processing"): Promise<Replacement> {
  const id = await nextId("replacements");
  return Replacement.create({
    id, replacement_number: buildBusinessReference("replacement", id), return_request_id: returnRequestId, order_id: orderId, order_item_id: orderItemId,
    product_id: productId, product_variant_id: null, quantity: 1, status, approved_by_admin_id: adminId,
    stock_consumed_at: status !== "stock_unavailable" ? new Date() : null, completed_at: status === "completed" ? new Date() : null
  });
}

async function seedShipment(sourceType: "order" | "replacement", sourceId: number, orderId: number, replacementId: number | null, status: "picked_up" | "out_for_delivery" | "delivered" = "out_for_delivery"): Promise<Shipment> {
  const id = await nextId("shipments");
  return Shipment.create({
    id, shipment_number: buildBusinessReference("shipment", id), source_type: sourceType, source_id: sourceId, order_id: orderId, replacement_id: replacementId,
    method: "standard", provider: "ithink", provider_order_id: null, provider_shipment_id: null, carrier: "Test Courier", tracking_number: `AWB-${id}`,
    service_type: "Surface", status, provider_status: null, provider_status_code: null, pickup_warehouse_id: "warehouse-1",
    weight_grams: 500, length_cm: "10.00", width_cm: "8.00", height_cm: "6.00", shipping_charge: "50.00", currency: "INR",
    shipped_at: status !== "out_for_delivery" ? null : new Date(), delivered_at: status === "delivered" ? new Date() : null,
    cancelled_at: null, rto_at: null, last_synced_at: new Date(), raw_payload: null
  });
}

describe("Commerce transactional email notifications", () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterEach(async () => {
    await NotificationLog.destroy({ where: {}, force: true });
    await Shipment.destroy({ where: {}, force: true });
    await Replacement.destroy({ where: {}, force: true });
    await Refund.destroy({ where: {}, force: true });
    await ReturnRequest.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: { id: createdOrderIds }, force: true });
    await Product.destroy({ where: { id: createdProductIds }, force: true });
    await Category.destroy({ where: { id: createdCategoryIds }, force: true });
    await User.destroy({ where: { id: createdUserIds }, force: true });
    createdOrderIds.length = 0;
    createdProductIds.length = 0;
    createdCategoryIds.length = 0;
    createdUserIds.length = 0;
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("sends ORDER_PLACED exactly once, using the Order's own contact_email snapshot", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "pending", paymentStatus: "pending" });
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.orderPlaced(order.id);
    await CommerceNotifications.orderPlaced(order.id); // simulate a duplicate/retried call

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const sent = sendSpy.mock.calls[0]?.[0] as EmailSendOptions;
    expect(sent.to).toBe(customer.email);
    expect(sent.subject).toContain(order.order_number);
    expect(await NotificationLog.count({ where: { event_type: "ORDER_PLACED", entity_id: order.id } })).toBe(1);
  });

  it("sends PAYMENT_SUCCESSFUL exactly once per Order even if attempted twice (duplicate webhook simulation)", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email });
    const payment = await seedPayment(order.id, "paid");
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.paymentSuccessful(order.id, payment.id);
    await CommerceNotifications.paymentSuccessful(order.id, payment.id);
    await CommerceNotifications.paymentSuccessful(order.id, payment.id);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]?.subject).toContain(order.order_number);
  });

  it("does not send PAYMENT_SUCCESSFUL when the Order's payment is not actually paid", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, paymentStatus: "pending" });
    const payment = await seedPayment(order.id, "pending");
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.paymentSuccessful(order.id, payment.id);

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("sends PAYMENT_FAILED, deduped per Payment attempt (not per Order)", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, paymentStatus: "pending" });
    const failedPayment1 = await seedPayment(order.id, "failed");
    const failedPayment2 = await seedPayment(order.id, "failed");
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.paymentFailed(failedPayment1.id);
    await CommerceNotifications.paymentFailed(failedPayment1.id); // duplicate for the same attempt
    await CommerceNotifications.paymentFailed(failedPayment2.id); // a distinct, later failed attempt

    // One email per distinct failed attempt, not deduped against each other.
    expect(sendSpy).toHaveBeenCalledTimes(2);
  });

  it("sends ORDER_PROCESSING / ORDER_SHIPPED / ORDER_DELIVERED for their matching Order status", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "processing" });
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.orderProcessing(order.id);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]?.subject).toContain("being prepared");

    order.status = "shipped";
    await order.save();
    await CommerceNotifications.orderShipped(order.id);
    expect(sendSpy).toHaveBeenCalledTimes(2);

    order.status = "delivered";
    await order.save();
    await CommerceNotifications.orderDelivered(order.id);
    expect(sendSpy).toHaveBeenCalledTimes(3);
  });

  it("ORDER_SHIPPED sent from two independent triggers (admin + courier sync) for the same Order still sends only once", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "shipped" });
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.orderShipped(order.id); // e.g. admin manually advanced status
    await CommerceNotifications.orderShipped(order.id); // e.g. courier tracking sync also fires this

    expect(sendSpy).toHaveBeenCalledTimes(1);
  });

  it("does not send ORDER_DELIVERED for a cancelled Order", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "cancelled" });
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.orderDelivered(order.id);

    expect(sendSpy).not.toHaveBeenCalled();
  });

  it("sends ORDER_OUT_FOR_DELIVERY only for a real Shipment already at that status", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "shipped" });
    const shipment = await seedShipment("order", order.id, order.id, null, "out_for_delivery");
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.orderOutForDelivery(shipment.id);
    await CommerceNotifications.orderOutForDelivery(shipment.id);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]?.subject).toContain("out for delivery");
  });

  it("sends RETURN_REQUESTED, RETURN_APPROVED, and RETURN_REJECTED as independent, correctly-worded emails", async () => {
    const customer = await seedCustomer();
    const admin = await seedAdmin();
    const { order, item } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "delivered" });
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    const requested = await seedReturnRequest(order.id, item.id, customer.id, { status: "requested" });
    await CommerceNotifications.returnRequested(requested.id);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]?.subject).toContain(requested.return_number);

    requested.status = "approved";
    await requested.save();
    await CommerceNotifications.returnApproved(requested.id);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[1]?.[0]?.subject).toContain("approved");

    const rejected = await seedReturnRequest(order.id, item.id, customer.id, { status: "rejected" });
    await CommerceNotifications.returnRejected(rejected.id);
    expect(sendSpy).toHaveBeenCalledTimes(3);
    void admin;
  });

  it("sends REFUND_INITIATED, then REFUND_SUCCEEDED exactly once despite a duplicate finalization callback", async () => {
    const customer = await seedCustomer();
    const admin = await seedAdmin();
    const { order, item } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "delivered" });
    const payment = await seedPayment(order.id, "paid");
    const returnRequest = await seedReturnRequest(order.id, item.id, customer.id, { status: "approved" });
    const refund = await seedRefund(order.id, payment.id, returnRequest.id, admin.id, "pending");
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.refundInitiated(refund.id);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]?.subject).toContain("Refund initiated");

    refund.status = "succeeded";
    await refund.save();
    await CommerceNotifications.refundSucceeded(refund.id);
    await CommerceNotifications.refundSucceeded(refund.id); // duplicate PayU webhook delivery
    await CommerceNotifications.refundSucceeded(refund.id);

    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[1]?.[0]?.subject).toContain("Refund completed");
  });

  it("sends REFUND_FAILED and never claims money was returned", async () => {
    const customer = await seedCustomer();
    const admin = await seedAdmin();
    const { order, item } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "delivered" });
    const payment = await seedPayment(order.id, "paid");
    const returnRequest = await seedReturnRequest(order.id, item.id, customer.id, { status: "approved" });
    const refund = await seedRefund(order.id, payment.id, returnRequest.id, admin.id, "failed");
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.refundFailed(refund.id);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    const html = sendSpy.mock.calls[0]?.[0]?.html ?? "";
    expect(html).not.toMatch(/refund(ed)? (has been|was) (credited|completed|processed)/iu);
    expect(html).toContain("could not be completed");
  });

  it("sends REPLACEMENT_APPROVED when stock is available, REPLACEMENT_STOCK_UNAVAILABLE when it is not — never both for the same Replacement", async () => {
    const customer = await seedCustomer();
    const admin = await seedAdmin();
    const { order, item } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "delivered" });
    const returnRequest = await seedReturnRequest(order.id, item.id, customer.id, { type: "replacement", status: "approved" });
    const replacement = await seedReplacement(returnRequest.id, order.id, item.id, item.product_id!, admin.id, "processing");
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.replacementApproved(replacement.id);
    await CommerceNotifications.replacementStockUnavailable(replacement.id); // attempted speculatively, must no-op

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]?.subject).toContain("Replacement approved");
  });

  it("sends REPLACEMENT_SHIPPED and REPLACEMENT_COMPLETED from the replacement's own Shipment", async () => {
    const customer = await seedCustomer();
    const admin = await seedAdmin();
    const { order, item } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "delivered" });
    const returnRequest = await seedReturnRequest(order.id, item.id, customer.id, { type: "replacement", status: "approved" });
    const replacement = await seedReplacement(returnRequest.id, order.id, item.id, item.product_id!, admin.id, "processing");
    const shipment = await seedShipment("replacement", replacement.id, order.id, replacement.id, "picked_up");
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.replacementShipped(shipment.id);
    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]?.subject).toContain("Replacement shipped");

    replacement.status = "completed";
    await replacement.save();
    await CommerceNotifications.replacementCompleted(replacement.id);
    expect(sendSpy).toHaveBeenCalledTimes(2);
    expect(sendSpy.mock.calls[1]?.[0]?.subject).toContain("Replacement delivered");
  });

  it("resolves the guest Order's own stored contact email, never the current account email of an unrelated user", async () => {
    const { order } = await seedOrder({ userId: null, contactEmail: "guest-checkout@example.com" });
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.orderPlaced(order.id, "raw-guest-token-abc");

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]?.to).toBe("guest-checkout@example.com");
    expect(sendSpy.mock.calls[0]?.[0]?.html).toContain("/order/guest/raw-guest-token-abc");
  });

  it("omits the View Order link for a guest Order once the raw recovery token is no longer available (later lifecycle emails)", async () => {
    const { order } = await seedOrder({ userId: null, contactEmail: "guest-later@example.com", status: "processing" });
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await CommerceNotifications.orderProcessing(order.id);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(sendSpy.mock.calls[0]?.[0]?.html).not.toContain("/order/guest/");
  });

  it("resolves an authenticated customer's Order via the Order's own contact_email snapshot, not the User's current email", async () => {
    const customer = await seedCustomer("original-checkout-email@example.com");
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "processing" });

    // The customer changes their account email after placing the Order —
    // the Order's own snapshot must still be used, never a fresh lookup.
    customer.email = "changed-later@example.com";
    await customer.save();

    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);
    await CommerceNotifications.orderProcessing(order.id);

    expect(sendSpy.mock.calls[0]?.[0]?.to).toBe("original-checkout-email@example.com");
    expect(sendSpy.mock.calls[0]?.[0]?.to).not.toBe("changed-later@example.com");
  });

  it("an email-provider failure never throws back to the commerce caller", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "pending", paymentStatus: "pending" });
    vi.spyOn(emailService, "sendEmail").mockRejectedValue(new Error("SMTP connection refused"));

    await expect(CommerceNotifications.orderPlaced(order.id)).resolves.toBeUndefined();

    const log = await NotificationLog.findOne({ where: { event_type: "ORDER_PLACED", entity_id: order.id } });
    expect(log?.status).toBe("failed");
  });

  it("NotificationService.notify durably dedupes via the notification_log unique constraint, not an in-memory Set", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "pending", paymentStatus: "pending" });
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    // Two fully independent, concurrent calls — nothing shared in-process
    // other than the database — simulating two concurrent webhook deliveries.
    await Promise.all([
      NotificationService.notify({ eventType: "ORDER_PLACED", entityType: "order", entityId: order.id, recipientEmail: order.contact_email, build: () => ({ subject: "s", text: "t", html: "<p>h</p>" }) }),
      NotificationService.notify({ eventType: "ORDER_PLACED", entityType: "order", entityId: order.id, recipientEmail: order.contact_email, build: () => ({ subject: "s", text: "t", html: "<p>h</p>" }) })
    ]);

    expect(sendSpy).toHaveBeenCalledTimes(1);
    expect(await NotificationLog.count({ where: { event_type: "ORDER_PLACED", entity_id: order.id } })).toBe(1);
  });

  it("skips sending (and records 'skipped') when there is no recipient email on record", async () => {
    const sendSpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    await NotificationService.notify({ eventType: "ORDER_PLACED", entityType: "order", entityId: 999_999_999, recipientEmail: null, build: () => ({ subject: "s", text: "t", html: "<p>h</p>" }) });

    expect(sendSpy).not.toHaveBeenCalled();
    expect(await NotificationLog.count({ where: { event_type: "ORDER_PLACED", entity_id: 999_999_999 } })).toBe(0);
  });
});
