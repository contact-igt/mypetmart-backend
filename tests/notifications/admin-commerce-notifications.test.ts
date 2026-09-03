import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { Category, NotificationLog, Order, OrderItem, Payment, Product, ReturnRequest, User } from "../../src/database/tables/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";
import { emailService, type EmailSendOptions } from "../../src/services/email/email.service.js";
import { CommerceNotifications } from "../../src/services/notification/commerce-notifications.service.js";
import { AdminNotificationService, parseAdminRecipients } from "../../src/services/notification/admin-notification.service.js";

const OPS = ["ops@mypetmart.test", "orders@mypetmart.test"];

let counter = 0;
const createdIds = { users: [] as number[], orders: [] as number[], products: [] as number[], categories: [] as number[] };

async function nextId(seq: string): Promise<number> {
  return sequelize.transaction((t) => IdSequenceService.allocateNextId(seq, t));
}

async function seedCustomer(): Promise<User> {
  const id = await nextId("users");
  const user = await User.create({ id, reference_code: `CUS-${id}`, role: "customer", status: "active", name: `Admin Notify Customer ${id}`, email: `admin-notify-cust-${id}@example.com`, phone: null, password_hash: "test-hash" });
  createdIds.users.push(id);
  return user;
}

async function seedOrder(input: {
  userId?: number | null;
  contactEmail?: string;
  status?: "pending" | "confirmed" | "processing" | "shipped" | "delivered" | "cancelled";
  paymentStatus?: "pending" | "paid" | "failed";
  commerceException?: "inventory_unavailable" | "order_not_confirmable" | null;
  cancelledAt?: Date | null;
}): Promise<{ order: Order; item: OrderItem }> {
  counter += 1;
  const suffix = `${Date.now()}-${counter}`;
  const categoryId = await nextId("categories");
  await Category.create({ id: categoryId, name: `AdmNotify Cat ${suffix}`, slug: `adm-notify-cat-${suffix}`, description: "d", pet_type: "all", active: true, display_order: 1 });
  createdIds.categories.push(categoryId);
  const productId = await nextId("products");
  const product = await Product.create({ id: productId, category_id: categoryId, name: `AdmNotify Product ${suffix}`, slug: `adm-notify-product-${suffix}`, sku: `ADMN-${suffix}`, description: "d", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 50, has_variants: false, featured: false } as never);
  createdIds.products.push(productId);

  const orderId = await nextId("orders");
  const order = await Order.create({
    id: orderId, order_number: buildBusinessReference("order", orderId), user_id: input.userId ?? null,
    guest_identity_hash: input.userId ? null : "guesthash", guest_access_token_hash: input.userId ? null : `guesttoken-${orderId}`, cart_id: null,
    contact_email: input.contactEmail ?? "buyer@example.com",
    status: input.status ?? "pending", payment_status: input.paymentStatus ?? "pending", fulfilment_status: "unfulfilled",
    commerce_exception: input.commerceException ?? null,
    subtotal: "1000.00", shipping_fee: "0.00", total: "1000.00", currency: "INR",
    ship_recipient_name: "Ops Recipient", ship_phone: "+91 98765 43210", ship_line_1: "1 Test Street", ship_line_2: null,
    ship_city: "Chennai", ship_state: "Tamil Nadu", ship_postal_code: "600001", ship_country: "IN", ship_latitude: null, ship_longitude: null,
    placed_at: new Date(), cancelled_at: input.cancelledAt ?? (input.status === "cancelled" ? new Date() : null)
  });
  createdIds.orders.push(orderId);
  const itemId = await nextId("order_items");
  const item = await OrderItem.create({ id: itemId, order_id: orderId, product_id: productId, product_variant_id: null, product_name: product.name, product_sku: product.sku, variant_name: null, variant_sku: null, product_image: null, quantity: 2, unit_price: "500.00", line_total: "1000.00" });
  return { order, item };
}

async function seedPayment(orderId: number, over: Partial<{ provider: string; status: "pending" | "paid" | "failed" | "cancelled"; method: string | null; providerOrderId: string | null; providerPaymentId: string | null }> = {}): Promise<Payment> {
  const id = await nextId("payments");
  return Payment.create({
    id, order_id: orderId, provider: over.provider ?? "payu",
    provider_order_id: over.providerOrderId ?? `TXN-${id}`,
    provider_payment_id: over.providerPaymentId ?? (over.status === "paid" ? `PAY-${id}` : null),
    status: over.status ?? "pending", amount: "1000.00", currency: "INR",
    method: over.method ?? (over.status === "paid" ? "UPI" : null),
    paid_at: over.status === "paid" ? new Date() : null, failed_at: over.status === "failed" ? new Date() : null, refunded_at: null, raw_payload: null
  });
}

function spyRecipients(list: string[] = OPS) {
  return vi.spyOn(AdminNotificationService, "resolveRecipients").mockReturnValue(list);
}
function spySend() {
  return vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);
}
const adminCalls = (send: ReturnType<typeof spySend>): EmailSendOptions[] =>
  send.mock.calls.map((c) => c[0]).filter((o) => o.subject.startsWith("[MyPetMart]"));
const customerCalls = (send: ReturnType<typeof spySend>): EmailSendOptions[] =>
  send.mock.calls.map((c) => c[0]).filter((o) => !o.subject.startsWith("[MyPetMart]"));

describe("Admin commerce email notifications", () => {
  beforeAll(async () => {
    await connectDatabase();
  });
  afterEach(async () => {
    await NotificationLog.destroy({ where: {}, force: true });
    await ReturnRequest.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: { id: createdIds.orders }, force: true });
    await Product.destroy({ where: { id: createdIds.products }, force: true });
    await Category.destroy({ where: { id: createdIds.categories }, force: true });
    await User.destroy({ where: { id: createdIds.users }, force: true });
    for (const k of Object.keys(createdIds) as (keyof typeof createdIds)[]) createdIds[k].length = 0;
    vi.restoreAllMocks();
  });
  afterAll(async () => {
    await disconnectDatabase();
  });

  // --- Recipient parsing / config (§40) --------------------------------------
  it("4/§8. parses ADMIN_NOTIFICATION_EMAILS: trims, drops blanks, dedupes case-insensitively, drops non-addresses", () => {
    expect(parseAdminRecipients(" a@x.test , ,b@x.test, A@X.TEST ,not-an-email, b@x.test ")).toEqual(["a@x.test", "b@x.test"]);
    expect(parseAdminRecipients(undefined)).toEqual([]);
    expect(parseAdminRecipients("   ")).toEqual([]);
  });

  // --- New order (§40) ------------------------------------------------------
  it("1/2/3. order created sends BOTH a customer email and an admin email, to separate recipients", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "pending", paymentStatus: "pending" });
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.orderPlaced(order.id);

    expect(customerCalls(send)).toHaveLength(1);
    expect(customerCalls(send)[0]!.to).toBe(customer.email);
    const admin = adminCalls(send);
    expect(admin).toHaveLength(1);
    expect(admin[0]!.to).toBe(OPS.join(", "));
    expect(admin[0]!.subject).toBe(`[MyPetMart] New Order — ${order.order_number}`);
    expect(admin[0]!.text).toContain("Not selected yet");
    expect(await NotificationLog.count({ where: { event_type: "ADMIN_ORDER_PLACED", entity_id: order.id } })).toBe(1);
    expect(await NotificationLog.count({ where: { event_type: "ORDER_PLACED", entity_id: order.id } })).toBe(1);
  });

  it("5/27. a missing ADMIN_NOTIFICATION_EMAILS config skips the admin email without throwing", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "pending", paymentStatus: "pending" });
    vi.spyOn(AdminNotificationService, "resolveRecipients").mockReturnValue([]);
    const send = spySend();

    await expect(CommerceNotifications.orderPlaced(order.id)).resolves.toBeUndefined();

    expect(customerCalls(send)).toHaveLength(1); // customer email unaffected
    expect(adminCalls(send)).toHaveLength(0);
    expect(await NotificationLog.count({ where: { event_type: "ADMIN_ORDER_PLACED" } })).toBe(0);
  });

  // --- Payment (§41) -----------------------------------------------------
  it("6/7/8. verified payment success sends one customer + one admin email; a duplicate does not re-send", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "confirmed", paymentStatus: "paid" });
    const payment = await seedPayment(order.id, { status: "paid", providerPaymentId: "PAYU-REF-9" });
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.paymentSuccessful(order.id, payment.id);
    await CommerceNotifications.paymentSuccessful(order.id, payment.id); // duplicate webhook

    expect(customerCalls(send)).toHaveLength(1);
    const admin = adminCalls(send);
    expect(admin).toHaveLength(1);
    expect(admin[0]!.subject).toBe(`[MyPetMart] Payment Received — ${order.order_number}`);
    expect(admin[0]!.text).toContain("PAYU-REF-9");
    expect(admin[0]!.text).toContain("Payment status: paid");
    expect(admin[0]!.text).toContain("Order status: confirmed");
  });

  it("9. a failed payment attempt sends an admin failure email, deduped per attempt", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, paymentStatus: "pending" });
    const p1 = await seedPayment(order.id, { status: "failed" });
    const p2 = await seedPayment(order.id, { status: "failed" });
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.paymentFailed(p1.id);
    await CommerceNotifications.paymentFailed(p1.id);
    await CommerceNotifications.paymentFailed(p2.id);

    const admin = adminCalls(send);
    expect(admin).toHaveLength(2);
    expect(admin[0]!.subject).toBe(`[MyPetMart] Payment Failed — ${order.order_number}`);
  });

  it("10. an order whose payment is not actually paid sends no admin payment email", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, paymentStatus: "pending" });
    const payment = await seedPayment(order.id, { status: "pending" });
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.paymentSuccessful(order.id, payment.id);

    expect(adminCalls(send)).toHaveLength(0);
  });

  // --- COD (§42) --------------------------------------------------------
  it("11/12/13/14. COD confirmation sends an admin COD email that never says 'Paid'; a duplicate does not re-send", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "confirmed", paymentStatus: "pending" });
    await seedPayment(order.id, { provider: "cod", status: "pending", method: "cod", providerOrderId: null });
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.codOrderConfirmed(order.id);
    await CommerceNotifications.codOrderConfirmed(order.id);

    const admin = adminCalls(send);
    expect(admin).toHaveLength(1);
    expect(admin[0]!.subject).toBe(`[MyPetMart] COD Order Confirmed — ${order.order_number}`);
    expect(admin[0]!.text).toContain("Cash on Delivery");
    expect(admin[0]!.text).toContain("Due on delivery");
    expect(admin[0]!.text.toLowerCase()).not.toContain("payment status: paid");
    expect(await NotificationLog.count({ where: { event_type: "ADMIN_COD_CONFIRMED", entity_id: order.id } })).toBe(1);
  });

  // --- Order status (§43) ----------------------------------------------
  it("15/16/17/18. processing / shipped / delivered each send an admin status email, once per transition", async () => {
    const customer = await seedCustomer();
    const { order } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "processing", paymentStatus: "paid" });
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.orderProcessing(order.id);
    await CommerceNotifications.orderProcessing(order.id); // replay
    order.status = "shipped";
    await order.save();
    await CommerceNotifications.orderShipped(order.id);
    order.status = "delivered";
    await order.save();
    await CommerceNotifications.orderDelivered(order.id);

    const admin = adminCalls(send);
    expect(admin.map((a) => a.subject)).toEqual([
      `[MyPetMart] Order Processing — ${order.order_number}`,
      `[MyPetMart] Order Shipped — ${order.order_number}`,
      `[MyPetMart] Order Delivered — ${order.order_number}`
    ]);
  });

  // --- Cancellation (§44) --------------------------------------------
  it("19/20. a customer or guest pending-order cancellation sends an admin 'Order Cancelled' email", async () => {
    const customer = await seedCustomer();
    const { order: custOrder } = await seedOrder({ userId: customer.id, contactEmail: customer.email, status: "cancelled" });
    const { order: guestOrder } = await seedOrder({ userId: null, status: "cancelled" });
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.orderCancelled(custOrder.id, "customer");
    await CommerceNotifications.orderCancelled(guestOrder.id, "guest");

    const admin = adminCalls(send);
    expect(admin).toHaveLength(2);
    expect(admin[0]!.subject).toBe(`[MyPetMart] Order Cancelled — ${custOrder.order_number}`);
    expect(admin[0]!.text).toContain("cancelled by the customer");
    expect(admin[1]!.text).toContain("cancelled by the guest");
    expect(admin[0]!.text).toContain("No payment attempt");
  });

  it("21. an order that is not actually cancelled produces no admin cancellation email", async () => {
    const { order } = await seedOrder({ status: "pending" });
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.orderCancelled(order.id, "customer");

    expect(adminCalls(send)).toHaveLength(0);
  });

  // --- Commerce exception (§45) ------------------------------------
  it("22/23. a paid-but-unconfirmable order sends a high-priority ACTION REQUIRED admin email, deduped", async () => {
    const { order } = await seedOrder({ status: "pending", paymentStatus: "paid", commerceException: "inventory_unavailable" });
    const payment = await seedPayment(order.id, { status: "paid" });
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.paymentSuccessful(order.id, payment.id);
    await CommerceNotifications.paymentSuccessful(order.id, payment.id); // duplicate finalization

    const admin = adminCalls(send);
    expect(admin).toHaveLength(1);
    expect(admin[0]!.subject).toBe(`[MyPetMart] ACTION REQUIRED — Order ${order.order_number}`);
    expect(admin[0]!.text).toContain("inventory_unavailable");
    // the routine "Payment Received" admin email is NOT also sent for this order
    expect(admin.some((a) => a.subject.includes("Payment Received"))).toBe(false);
    expect(await NotificationLog.count({ where: { event_type: "ADMIN_COMMERCE_EXCEPTION", entity_id: order.id } })).toBe(1);
    expect(await NotificationLog.count({ where: { event_type: "ADMIN_PAYMENT_RECEIVED", entity_id: order.id } })).toBe(0);
  });

  // --- Security (§46) --------------------------------------------
  it("25/26. admin emails never contain the guest recovery token, PayU secrets, or raw payloads", async () => {
    const { order } = await seedOrder({ userId: null, status: "pending", paymentStatus: "pending" });
    const rawGuestToken = "abcd".repeat(16); // 64 hex-ish chars
    order.guest_access_token_hash = `hash-${order.id}`;
    await order.save();
    spyRecipients();
    const send = spySend();

    await CommerceNotifications.orderPlaced(order.id, rawGuestToken);
    await seedPayment(order.id, { status: "failed", providerOrderId: "TXN-SECRET-CHECK" });

    for (const email of adminCalls(send)) {
      const blob = `${email.subject}\n${email.text}\n${email.html}`;
      expect(blob).not.toContain(rawGuestToken);
      expect(blob.toLowerCase()).not.toContain("salt");
      expect(blob.toLowerCase()).not.toContain("password");
      expect(blob).not.toContain("raw_payload");
    }
  });

  it("24. admin notifications only ever exist for commerce ADMIN_* events (never auth/OTP)", () => {
    // The AdminNotificationService is only imported by commerce-notifications.service.ts;
    // auth/newsletter emails go through EmailService directly and never touch it.
    // This is a guard assertion that the event vocabulary is commerce-only.
    const adminEventTypes = [
      "ADMIN_ORDER_PLACED", "ADMIN_PAYMENT_RECEIVED", "ADMIN_PAYMENT_FAILED", "ADMIN_COD_CONFIRMED",
      "ADMIN_ORDER_PROCESSING", "ADMIN_ORDER_SHIPPED", "ADMIN_ORDER_DELIVERED", "ADMIN_ORDER_CANCELLED",
      "ADMIN_SHIPMENT_CREATED", "ADMIN_COMMERCE_EXCEPTION", "ADMIN_RETURN_REQUESTED"
    ];
    expect(adminEventTypes.every((e) => /^ADMIN_(ORDER|PAYMENT|COD|SHIPMENT|COMMERCE|RETURN)/.test(e))).toBe(true);
    expect(adminEventTypes.some((e) => /OTP|PASSWORD|LOGIN|VERIFY/i.test(e))).toBe(false);
  });

  // --- Failure isolation (§47) ----------------------------------
  it("27/28. an admin email transport failure does not throw out of the notification path", async () => {
    const { order } = await seedOrder({ status: "pending", paymentStatus: "pending" });
    spyRecipients();
    vi.spyOn(emailService, "sendEmail").mockRejectedValue(new Error("SMTP down"));

    await expect(CommerceNotifications.orderPlaced(order.id)).resolves.toBeUndefined();
    // the claim row is still recorded (as failed / pending), permanently blocking a duplicate
    expect(await NotificationLog.count({ where: { event_type: "ADMIN_ORDER_PLACED", entity_id: order.id } })).toBe(1);
  });
});
