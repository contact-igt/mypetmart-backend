import { UniqueConstraintError } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { OrderDocument } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import type { CustomerOrderPaymentJSON, CustomerOrderRefundSummaryJSON, OrderItemJSON } from "../OrderModels/order.types.js";
import { OrderService } from "../OrderModels/order.service.js";
import { SettingsService } from "../SettingsModels/settings.service.js";
import { renderHtmlToPdf } from "./pdf-renderer.js";
import { buildReceiptHtml } from "./receipt.template.js";
import type { CustomerReceiptJSON, RenderedReceipt } from "./receipt.types.js";

// The minimal shape this module actually reads off an Order — structurally
// satisfied by both OrderDetailJSON and GuestOrderDetailJSON (their only
// difference, shippingAddress.latitude/longitude, is never used here), so
// one render path serves both the customer and guest download endpoints.
type ReceiptSourceOrder = {
  id: number;
  orderNumber: string;
  placedAt: string;
  contactEmail: string;
  shippingAddress: { recipientName: string; phone: string; line1: string; line2: string | null; city: string; state: string; postalCode: string; country: string };
  items: OrderItemJSON[];
  payments: CustomerOrderPaymentJSON[];
  refundSummary: CustomerOrderRefundSummaryJSON | null;
  subtotal: string;
  shippingFee: string;
  total: string;
};

// Mirrors order-detail-client.tsx's own pickDisplayPayment exactly (a
// failed/retried attempt shouldn't be "the" payment a customer sees) — kept
// as a small server-side copy since the frontend/backend are separate
// deployables with no shared package for this one selection rule.
function pickDisplayPayment(payments: CustomerOrderPaymentJSON[]): CustomerOrderPaymentJSON | null {
  return payments.find((payment) => payment.status === "paid" || payment.status === "refunded") ?? payments[payments.length - 1] ?? null;
}

/**
 * Finds this Order's existing "receipt" document row, or allocates one.
 * Assigned exactly once per Order and reused on every later download (see
 * OrderDocumentTable's own doc comment) — never a fresh number per request.
 * The UniqueConstraintError catch covers the narrow race where two
 * concurrent first-time downloads both pass the initial lookup before either
 * commits; whichever loses the DB-level unique constraint simply re-reads
 * the winner's row instead of erroring.
 */
async function getOrCreateReceiptDocument(orderId: number): Promise<OrderDocument> {
  const existing = await OrderDocument.findOne({ where: { order_id: orderId, document_type: "receipt" } });
  if (existing) return existing;

  try {
    return await sequelize.transaction(async (transaction) => {
      const existingInTransaction = await OrderDocument.findOne({ where: { order_id: orderId, document_type: "receipt" }, transaction, lock: transaction.LOCK.UPDATE });
      if (existingInTransaction) return existingInTransaction;
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.orderDocuments, transaction);
      // Truncated to whole seconds — MySQL's DATETIME column has no
      // fractional-second precision, so every later read-back of this same
      // row already loses milliseconds. Truncating here too keeps this
      // very first in-memory value consistent with every subsequent read.
      const generatedAt = new Date(Math.floor(Date.now() / 1000) * 1000);
      return OrderDocument.create({ id, order_id: orderId, document_type: "receipt", document_number: buildBusinessReference("receipt", id), generated_at: generatedAt }, { transaction });
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      const winner = await OrderDocument.findOne({ where: { order_id: orderId, document_type: "receipt" } });
      if (winner) return winner;
    }
    throw error;
  }
}

function toReceiptData(order: ReceiptSourceOrder, document: OrderDocument): CustomerReceiptJSON {
  const displayPayment = pickDisplayPayment(order.payments);
  const address = order.shippingAddress;

  return {
    receiptNumber: document.document_number,
    receiptDate: document.generated_at.toISOString(),
    order: { orderNumber: order.orderNumber, placedAt: order.placedAt },
    // Deliberately the Order's own immutable snapshot (ship_recipient_name/
    // ship_phone/contact_email), never a live User lookup — a receipt must
    // reflect who the transaction was actually with at the time, not
    // whatever a customer has since edited on their profile. This also
    // makes the guest and customer paths identical: a guest has no User row
    // to look up at all.
    customer: { name: address.recipientName, email: order.contactEmail, phone: address.phone },
    address: { recipientName: address.recipientName, phone: address.phone, line1: address.line1, line2: address.line2, city: address.city, state: address.state, postalCode: address.postalCode, country: address.country },
    items: order.items.map((item) => ({
      name: item.productName,
      sku: item.variantSku ?? item.productSku,
      variant: item.variantName,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      lineTotal: item.lineTotal
    })),
    payment: {
      method: displayPayment?.method ?? null,
      status: displayPayment?.status ?? "pending",
      transactionReference: displayPayment?.providerOrderId ?? null,
      paidAt: displayPayment?.paidAt ?? null
    },
    totals: { subtotal: order.subtotal, shippingFee: order.shippingFee, total: order.total },
    refundSummary: order.refundSummary ? { status: order.refundSummary.status, refundedAmount: order.refundSummary.totalRefunded } : null
  };
}

async function buildReceiptData(order: ReceiptSourceOrder): Promise<CustomerReceiptJSON> {
  const document = await getOrCreateReceiptDocument(order.id);
  return toReceiptData(order, document);
}

async function renderPdf(receipt: CustomerReceiptJSON): Promise<RenderedReceipt> {
  const storeProfile = await SettingsService.getStoreProfile();
  const html = buildReceiptHtml(receipt, storeProfile);
  const buffer = await renderHtmlToPdf(html);
  return { buffer, filename: `${receipt.receiptNumber}.pdf` };
}

export const ReceiptService = {
  /**
   * Ownership is validated entirely by OrderService.getCustomerOrder itself
   * (id + user_id match, else OrderNotFoundError) — never re-implemented
   * here, so there is exactly one place in the codebase that decides "does
   * this user own this Order". Data-only (no PDF/Chromium) — used directly
   * by most tests, and internally by generateForCustomer below.
   */
  async getReceiptDataForCustomer(userId: number, orderId: number): Promise<CustomerReceiptJSON> {
    const order = await OrderService.getCustomerOrder(userId, orderId);
    return buildReceiptData(order);
  },

  /**
   * Same principle for guests — OrderService.getGuestOrder's own token-hash
   * lookup is the sole access check (GuestOrderNotFoundError on any mismatch).
   */
  async getReceiptDataForGuest(rawToken: string): Promise<CustomerReceiptJSON> {
    const order = await OrderService.getGuestOrder(rawToken);
    return buildReceiptData(order);
  },

  async generateForCustomer(userId: number, orderId: number): Promise<RenderedReceipt> {
    const receipt = await ReceiptService.getReceiptDataForCustomer(userId, orderId);
    return renderPdf(receipt);
  },

  async generateForGuest(rawToken: string): Promise<RenderedReceipt> {
    const receipt = await ReceiptService.getReceiptDataForGuest(rawToken);
    return renderPdf(receipt);
  }
};
