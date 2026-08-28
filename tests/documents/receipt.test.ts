import crypto from "node:crypto";
import { Op } from "sequelize";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { ReceiptService } from "../../src/models/DocumentModels/receipt.service.js";
import { closePdfRenderer } from "../../src/models/DocumentModels/pdf-renderer.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { buildBusinessReference } from "../../src/utils/reference-generator.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";
import { Category, Order, OrderDocument, OrderItem, Payment, Product, Refund, User } from "../../src/database/tables/index.js";

describe("ReceiptService (Phase E.2)", () => {
  const baseId = 993_000;
  let counter = 0;

  async function clean(): Promise<void> {
    await OrderDocument.destroy({ where: {}, force: true });
    await Refund.destroy({ where: {}, force: true });
    await Payment.destroy({ where: {}, force: true });
    await OrderItem.destroy({ where: {}, force: true });
    await Order.destroy({ where: {}, force: true });
    await Product.destroy({ where: {}, force: true });
    await Category.destroy({ where: {}, force: true });
    await User.destroy({ where: { id: { [Op.gte]: baseId } }, force: true });
  }

  async function createUser() {
    counter += 1;
    const id = baseId + counter * 100;
    return User.create({ id, reference_code: `USR-${id}`, role: "customer", status: "active", name: "Riya Sharma", email: `riya-${id}@example.com`, phone: "+91 98765 43210", password_hash: "test", email_verified_at: null, last_login_at: null });
  }

  async function createAdmin() {
    counter += 1;
    const id = baseId + counter * 100;
    return User.create({ id, reference_code: `ADM-${id}`, role: "admin", status: "active", name: "Ops Admin", email: `admin-${id}@example.com`, phone: null, password_hash: "test", email_verified_at: null, last_login_at: null });
  }

  async function createOrder(options: { userId?: number | null; items?: Array<{ variantName?: string | null; variantSku?: string | null }> } = {}) {
    counter += 1;
    const suffix = `${Date.now()}-${counter}`;
    const id = baseId + counter * 100;
    const category = await Category.create({ id, name: `Receipt ${suffix}`, slug: `receipt-${suffix}`, description: "Receipt test", pet_type: "all", active: true, display_order: 1 });
    const product = await Product.create({ id: id + 1, category_id: category.id, name: `Receipt Product ${suffix}`, slug: `receipt-product-${suffix}`, sku: `RCPT-${suffix}`, description: "Receipt test", pet_type: "all", status: "active", price: "500.00", compare_at_price: null, stock: 20, has_variants: false, featured: false, tags: null, meta_title: null, meta_description: null, weight_grams: 250, length_cm: "10.00", width_cm: "8.00", height_cm: "5.00" });
    const order = await Order.create({
      id: id + 2, order_number: `ORD-${suffix}`, user_id: options.userId ?? null, guest_identity_hash: null, guest_access_token_hash: null, cart_id: null,
      contact_email: "receipt-test@example.com", status: "confirmed", payment_status: "paid", fulfilment_status: "unfulfilled", commerce_exception: null,
      subtotal: "1000.00", shipping_fee: "0.00", total: "1000.00", currency: "INR", ship_recipient_name: "Riya Sharma", ship_phone: "+91 98765 43210",
      ship_line_1: "10 MG Road", ship_line_2: "Near Central Park", ship_city: "Mumbai", ship_state: "Maharashtra", ship_postal_code: "400001", ship_country: "IN",
      ship_latitude: null, ship_longitude: null, placed_at: new Date("2026-08-20T08:00:00.000Z"), cancelled_at: null
    });
    const itemSpecs = options.items && options.items.length > 0 ? options.items : [{}];
    let itemId = id + 3;
    for (const spec of itemSpecs) {
      await OrderItem.create({ id: itemId, order_id: order.id, product_id: product.id, product_variant_id: null, product_name: product.name, product_sku: product.sku, variant_name: spec.variantName ?? null, variant_sku: spec.variantSku ?? null, product_image: null, quantity: 2, unit_price: "500.00", line_total: "1000.00" });
      itemId += 1;
    }
    return { order, user: options.userId ? await User.findByPk(options.userId) : null, nextId: itemId };
  }

  async function createGuestOrder() {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const { order, nextId } = await createOrder({ userId: null });
    await order.update({ guest_access_token_hash: TokenService.hashToken(rawToken), guest_identity_hash: crypto.randomBytes(16).toString("hex") });
    return { order, rawToken, nextId };
  }

  async function addPayment(orderId: number, id: number, overrides: Partial<{ provider: string; status: "pending" | "paid" | "failed" | "refunded" | "cancelled" | "partially_refunded"; method: string | null; providerOrderId: string | null; paidAt: Date | null }> = {}) {
    return Payment.create({
      id, order_id: orderId, provider: overrides.provider ?? "payu", provider_order_id: overrides.providerOrderId !== undefined ? overrides.providerOrderId : `PROV-${id}`, provider_payment_id: overrides.status === "paid" ? `PAY-${id}` : null,
      status: overrides.status ?? "paid", amount: "1000.00", currency: "INR", method: overrides.method ?? "card",
      paid_at: overrides.paidAt !== undefined ? overrides.paidAt : overrides.status === "paid" ? new Date("2026-08-20T09:00:00.000Z") : null,
      failed_at: null, refunded_at: null, raw_payload: null
    });
  }

  async function addRefund(orderId: number, paymentId: number, id: number, adminId: number, status: "pending" | "processing" | "succeeded" | "failed" = "succeeded") {
    return Refund.create({
      id, refund_number: buildBusinessReference("refund", id), order_id: orderId, payment_id: paymentId, return_request_id: null,
      provider: "payu", provider_refund_token: `REFTOK-${id}`, provider_request_id: null, provider_refund_id: status === "succeeded" ? `PROVREF-${id}` : null,
      provider_status: null, status, amount: "300.00", currency: "INR", failure_code: null, failure_message: null,
      initiated_by_admin_id: adminId, initiated_at: new Date(), completed_at: status === "succeeded" ? new Date() : null, failed_at: status === "failed" ? new Date() : null, raw_payload: null
    });
  }

  beforeAll(async () => { await connectDatabase(); });
  beforeEach(async () => { await clean(); });
  afterAll(async () => { await clean(); await disconnectDatabase(); await closePdfRenderer(); });

  describe("Customer receipt data", () => {
    it("generates a REC-###### receipt number and the expected order/customer/address/totals fields", async () => {
      const user = await createUser();
      const { order } = await createOrder({ userId: user.id });

      const receipt = await ReceiptService.getReceiptDataForCustomer(user.id, order.id);

      expect(receipt.receiptNumber).toMatch(/^REC-\d{6}$/);
      expect(receipt.order).toMatchObject({ orderNumber: order.order_number, placedAt: order.placed_at.toISOString() });
      expect(receipt.customer).toMatchObject({ name: "Riya Sharma", email: "receipt-test@example.com", phone: "+91 98765 43210" });
      expect(receipt.address).toMatchObject({ recipientName: "Riya Sharma", phone: "+91 98765 43210", line1: "10 MG Road", line2: "Near Central Park", city: "Mumbai", state: "Maharashtra", postalCode: "400001", country: "IN" });
      expect(receipt.totals).toMatchObject({ subtotal: "1000.00", shippingFee: "0.00", total: "1000.00" });
    });

    it("assigns the receipt number exactly once and reuses it on repeat requests, including the same receiptDate", async () => {
      const user = await createUser();
      const { order } = await createOrder({ userId: user.id });

      const first = await ReceiptService.getReceiptDataForCustomer(user.id, order.id);
      const second = await ReceiptService.getReceiptDataForCustomer(user.id, order.id);

      expect(second.receiptNumber).toBe(first.receiptNumber);
      expect(second.receiptDate).toBe(first.receiptDate);
      expect(await OrderDocument.count({ where: { order_id: order.id, document_type: "receipt" } })).toBe(1);
    });

    it("includes every item, falling back to the product SKU when no variant SKU exists", async () => {
      const user = await createUser();
      const { order } = await createOrder({ userId: user.id, items: [{ variantName: "Large", variantSku: "RCPT-L" }, {}] });

      const receipt = await ReceiptService.getReceiptDataForCustomer(user.id, order.id);

      expect(receipt.items).toHaveLength(2);
      expect(receipt.items[0]).toMatchObject({ variant: "Large", sku: "RCPT-L", quantity: 2, unitPrice: "500.00", lineTotal: "1000.00" });
      expect(receipt.items[1]).toMatchObject({ variant: null });
      expect(receipt.items[1]!.sku).not.toBe("");
    });

    it("reflects a COD order's payment method and pending status (never fabricated as paid)", async () => {
      const user = await createUser();
      const { order, nextId } = await createOrder({ userId: user.id });
      await addPayment(order.id, nextId, { provider: "cod", method: "cod", status: "pending", providerOrderId: null, paidAt: null });

      const receipt = await ReceiptService.getReceiptDataForCustomer(user.id, order.id);

      expect(receipt.payment).toMatchObject({ method: "cod", status: "pending", transactionReference: null, paidAt: null });
    });

    it("reflects a PayU order's payment method, transaction reference, and paid date", async () => {
      const user = await createUser();
      const { order, nextId } = await createOrder({ userId: user.id });
      await addPayment(order.id, nextId, { provider: "payu", method: "card", status: "paid", providerOrderId: "TXN-98765" });

      const receipt = await ReceiptService.getReceiptDataForCustomer(user.id, order.id);

      expect(receipt.payment).toMatchObject({ method: "card", status: "paid", transactionReference: "TXN-98765" });
      expect(receipt.payment.paidAt).toBeTruthy();
    });

    it("includes a refund summary when a succeeded refund exists on the order", async () => {
      const user = await createUser();
      const admin = await createAdmin();
      const { order, nextId } = await createOrder({ userId: user.id });
      const payment = await addPayment(order.id, nextId, { status: "paid" });
      await addRefund(order.id, payment.id, nextId + 1, admin.id, "succeeded");

      const receipt = await ReceiptService.getReceiptDataForCustomer(user.id, order.id);

      expect(receipt.refundSummary).toMatchObject({ status: "succeeded", refundedAmount: "300.00" });
    });

    it("omits refundSummary (null) when no refund exists", async () => {
      const user = await createUser();
      const { order } = await createOrder({ userId: user.id });

      const receipt = await ReceiptService.getReceiptDataForCustomer(user.id, order.id);

      expect(receipt.refundSummary).toBeNull();
    });
  });

  describe("Security — ownership and token validation", () => {
    it("never lets one customer generate another customer's receipt", async () => {
      const owner = await createUser();
      const stranger = await createUser();
      const { order } = await createOrder({ userId: owner.id });

      await expect(ReceiptService.getReceiptDataForCustomer(stranger.id, order.id)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    });

    it("rejects a request for a non-existent order id", async () => {
      const user = await createUser();
      await expect(ReceiptService.getReceiptDataForCustomer(user.id, 999_999_999)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    });

    it("rejects an unknown or malformed guest token without leaking which", async () => {
      await expect(ReceiptService.getReceiptDataForGuest(crypto.randomBytes(32).toString("hex"))).rejects.toMatchObject({ code: "GUEST_ORDER_NOT_FOUND" });
    });

    it("never lets a customer order be recovered through the guest token path", async () => {
      const user = await createUser();
      const { order } = await createOrder({ userId: user.id }); // no guest_access_token_hash set
      const someToken = crypto.randomBytes(32).toString("hex");
      await order.update({ guest_access_token_hash: TokenService.hashToken(someToken) });
      // Even with a hash present, user_id is non-null on this Order — the
      // service's own `user_id: null` guard (mirrored from OrderService)
      // must still refuse it.
      await expect(ReceiptService.getReceiptDataForGuest(someToken)).rejects.toMatchObject({ code: "GUEST_ORDER_NOT_FOUND" });
    });
  });

  describe("Guest receipt data", () => {
    it("returns receipt data for a valid guest recovery token", async () => {
      const { order, rawToken } = await createGuestOrder();

      const receipt = await ReceiptService.getReceiptDataForGuest(rawToken);

      expect(receipt.order.orderNumber).toBe(order.order_number);
      expect(receipt.receiptNumber).toMatch(/^REC-\d{6}$/);
    });

    it("reuses the same receipt number for a guest across repeat requests", async () => {
      const { rawToken } = await createGuestOrder();

      const first = await ReceiptService.getReceiptDataForGuest(rawToken);
      const second = await ReceiptService.getReceiptDataForGuest(rawToken);

      expect(second.receiptNumber).toBe(first.receiptNumber);
    });
  });

  // Slower (real headless Chromium) — kept to the minimum needed to prove
  // the full HTML -> PDF pipeline actually produces a valid file, not just
  // that the data assembly above is correct.
  describe("PDF rendering (end-to-end)", () => {
    it("renders a real PDF for a customer order, named after the receipt number", async () => {
      const user = await createUser();
      const { order } = await createOrder({ userId: user.id });

      const { buffer, filename } = await ReceiptService.generateForCustomer(user.id, order.id);

      expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(buffer.byteLength).toBeGreaterThan(500);
      expect(filename).toMatch(/^REC-\d{6}\.pdf$/);
    }, 30_000);

    it("renders a real PDF for a guest order via the recovery token", async () => {
      const { rawToken } = await createGuestOrder();

      const { buffer, filename } = await ReceiptService.generateForGuest(rawToken);

      expect(buffer.subarray(0, 5).toString("latin1")).toBe("%PDF-");
      expect(filename).toMatch(/^REC-\d{6}\.pdf$/);
    }, 30_000);
  });
});
