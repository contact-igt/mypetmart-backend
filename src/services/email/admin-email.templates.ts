// Operational admin-team email templates. Deliberately NOT the customer
// templates in commerce-email.templates.ts — different audience, different
// purpose: a compact operational summary + a direct link into the Admin panel,
// never customer reassurance copy. Branding matches the customer templates
// (cream body, orange heading) but the header reads "MyPetMart Admin
// Notification" so an operator can tell the two apart at a glance.
//
// SAFETY: templates only ever receive already-safe, already-formatted fields
// (order number, masked-free customer name/email, money strings, statuses,
// provider name, provider *reference* id). They never receive — and must
// never render — a guest recovery token, a JWT, a PayU salt/signature, a raw
// webhook payload, card data, or a stack trace.

import { environmentConfig } from "../../config/environment.config.js";

export type EmailTemplate = { subject: string; text: string; html: string };

function currencyPrefix(currency: string): string {
  return currency === "INR" ? "₹" : `${currency} `;
}

function money(amount: string, currency: string): string {
  return `${currencyPrefix(currency)}${amount}`;
}

// Deep link into the Admin panel for an Order. ADMIN_ORIGIN is a required env
// var (the admin frontend base URL) — never a hardcoded localhost.
function adminOrderUrl(orderId: number): string {
  return `${environmentConfig.ADMIN_ORIGIN.replace(/\/$/, "")}/admin/orders/${orderId}`;
}

function shell(title: string, bodyHtml: string, ctaUrl?: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto; padding: 24px; background: #fff5e9; border-radius: 16px; color: #35221b;">
      <p style="font-size: 12px; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase; color: #bb5036; margin: 0 0 4px;">MyPetMart Admin Notification</p>
      <h2 style="color: #d65e2a; margin: 0 0 16px; font-family: 'Baloo 2', sans-serif;">${title}</h2>
      ${bodyHtml}
      ${ctaUrl ? `<div style="margin: 22px 0 6px;"><a href="${ctaUrl}" style="display: inline-block; background: #d65e2a; color: #ffffff; font-weight: bold; text-decoration: none; padding: 10px 24px; border-radius: 999px; font-size: 13px;">Open in Admin panel</a></div>` : ""}
      <hr style="border: 0; border-top: 1px solid #e5d5c5; margin: 22px 0 12px;" />
      <p style="font-size: 11px; color: #999;">Automated operational alert for the MyPetMart operations team.</p>
    </div>
  `;
}

type Row = [label: string, value: string];

function rowsHtml(rows: Row[]): string {
  return `<table style="width: 100%; border-collapse: collapse; margin: 4px 0 8px;">${rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding: 5px 0; font-size: 13px; color: #7a6a5f; white-space: nowrap; vertical-align: top;">${label}</td>
          <td style="padding: 5px 0 5px 16px; font-size: 13px; color: #35221b; text-align: right;">${value}</td>
        </tr>`
    )
    .join("")}</table>`;
}

function rowsText(rows: Row[]): string {
  return rows.map(([label, value]) => `${label}: ${value}`).join("\n");
}

// ---------------------------------------------------------------------------

export type AdminOrderContext = {
  orderId: number;
  orderNumber: string;
  buyerLabel: string; // "Priya S." for a customer, "Guest" for a guest — never an email-derived identity
  contactEmail: string;
  shipRecipient: string;
  shipCity: string;
  shipState: string;
  shipPostalCode: string;
  total: string;
  currency: string;
  orderStatus: string;
};

export function getAdminNewOrderTemplate(ctx: AdminOrderContext & { paymentMethodLabel: string }): EmailTemplate {
  const rows: Row[] = [
    ["Order", ctx.orderNumber],
    ["Customer", ctx.buyerLabel],
    ["Email", ctx.contactEmail],
    ["Payment", ctx.paymentMethodLabel],
    ["Total", money(ctx.total, ctx.currency)],
    ["Status", ctx.orderStatus],
    ["Ship to", `${ctx.shipRecipient}, ${ctx.shipCity}, ${ctx.shipState} ${ctx.shipPostalCode}`]
  ];
  return {
    subject: `[MyPetMart] New Order — ${ctx.orderNumber}`,
    text: `New order received.\n\n${rowsText(rows)}\n\nManage: ${adminOrderUrl(ctx.orderId)}`,
    html: shell("New order received", rowsHtml(rows), adminOrderUrl(ctx.orderId))
  };
}

export function getAdminPaymentReceivedTemplate(ctx: {
  orderId: number;
  orderNumber: string;
  buyerLabel: string;
  amount: string;
  currency: string;
  provider: string;
  providerReference: string | null;
  orderStatus: string;
  paymentStatus: string;
}): EmailTemplate {
  const rows: Row[] = [
    ["Order", ctx.orderNumber],
    ["Customer", ctx.buyerLabel],
    ["Amount", money(ctx.amount, ctx.currency)],
    ["Provider", ctx.provider],
    ["Provider ref", ctx.providerReference ?? "—"],
    ["Payment status", ctx.paymentStatus],
    ["Order status", ctx.orderStatus]
  ];
  return {
    subject: `[MyPetMart] Payment Received — ${ctx.orderNumber}`,
    text: `Payment verified.\n\n${rowsText(rows)}\n\nManage: ${adminOrderUrl(ctx.orderId)}`,
    html: shell("Payment received", rowsHtml(rows), adminOrderUrl(ctx.orderId))
  };
}

export function getAdminPaymentFailedTemplate(ctx: {
  orderId: number;
  orderNumber: string;
  amount: string;
  currency: string;
  provider: string;
  providerReference: string | null;
  attemptStatus: string;
}): EmailTemplate {
  const rows: Row[] = [
    ["Order", ctx.orderNumber],
    ["Amount", money(ctx.amount, ctx.currency)],
    ["Provider", ctx.provider],
    ["Provider ref", ctx.providerReference ?? "—"],
    ["Attempt status", ctx.attemptStatus]
  ];
  return {
    subject: `[MyPetMart] Payment Failed — ${ctx.orderNumber}`,
    text: `A payment attempt failed.\n\n${rowsText(rows)}\n\nThe order remains payable; the customer may retry.\n\nManage: ${adminOrderUrl(ctx.orderId)}`,
    html: shell("Payment attempt failed", `${rowsHtml(rows)}<p style="font-size: 12px; color: #7a6a5f;">The order remains payable; the customer may retry.</p>`, adminOrderUrl(ctx.orderId))
  };
}

export function getAdminCodConfirmedTemplate(ctx: AdminOrderContext): EmailTemplate {
  const rows: Row[] = [
    ["Order", ctx.orderNumber],
    ["Customer", ctx.buyerLabel],
    ["Email", ctx.contactEmail],
    ["Total", money(ctx.total, ctx.currency)],
    ["Payment", "Cash on Delivery"],
    ["Collection", "Due on delivery (not yet paid)"],
    ["Order status", ctx.orderStatus],
    ["Ship to", `${ctx.shipRecipient}, ${ctx.shipCity}, ${ctx.shipState} ${ctx.shipPostalCode}`]
  ];
  return {
    subject: `[MyPetMart] COD Order Confirmed — ${ctx.orderNumber}`,
    text: `A Cash on Delivery order has been confirmed.\n\n${rowsText(rows)}\n\nManage: ${adminOrderUrl(ctx.orderId)}`,
    html: shell("COD order confirmed", rowsHtml(rows), adminOrderUrl(ctx.orderId))
  };
}

export function getAdminOrderStatusTemplate(ctx: {
  orderId: number;
  orderNumber: string;
  buyerLabel: string;
  newStatus: "processing" | "shipped" | "delivered";
  carrier?: string | null;
  awbNumber?: string | null;
}): EmailTemplate {
  const label = ctx.newStatus === "processing" ? "Order Processing" : ctx.newStatus === "shipped" ? "Order Shipped" : "Order Delivered";
  const rows: Row[] = [
    ["Order", ctx.orderNumber],
    ["Customer", ctx.buyerLabel],
    ["New status", ctx.newStatus]
  ];
  if (ctx.newStatus === "shipped") {
    rows.push(["Carrier", ctx.carrier ?? "—"], ["AWB", ctx.awbNumber ?? "—"]);
  }
  return {
    subject: `[MyPetMart] ${label} — ${ctx.orderNumber}`,
    text: `${label}.\n\n${rowsText(rows)}\n\nManage: ${adminOrderUrl(ctx.orderId)}`,
    html: shell(label, rowsHtml(rows), adminOrderUrl(ctx.orderId))
  };
}

export function getAdminShipmentCreatedTemplate(ctx: {
  orderId: number;
  orderNumber: string;
  shipmentId: number;
  carrier: string | null;
  awbNumber: string | null;
  shipmentStatus: string;
  shipRecipient: string;
  shipPostalCode: string;
}): EmailTemplate {
  const rows: Row[] = [
    ["Order", ctx.orderNumber],
    ["Shipment", `#${ctx.shipmentId}`],
    ["Carrier", ctx.carrier ?? "—"],
    ["AWB / tracking", ctx.awbNumber ?? "—"],
    ["Shipment status", ctx.shipmentStatus],
    ["Ship to", `${ctx.shipRecipient}, ${ctx.shipPostalCode}`]
  ];
  return {
    subject: `[MyPetMart] Shipment Created — ${ctx.orderNumber}`,
    text: `A shipment has been booked.\n\n${rowsText(rows)}\n\nManage: ${adminOrderUrl(ctx.orderId)}`,
    html: shell("Shipment created", rowsHtml(rows), adminOrderUrl(ctx.orderId))
  };
}

export function getAdminOrderCancelledTemplate(ctx: {
  orderId: number;
  orderNumber: string;
  buyerLabel: string;
  total: string;
  currency: string;
  cancelledBy: "customer" | "guest" | "admin";
  paymentContext: string; // e.g. "No payment attempt", "PayU attempt failed", "Refund initiated"
  cancelledAt: string;
}): EmailTemplate {
  const who = ctx.cancelledBy === "admin" ? "an admin" : ctx.cancelledBy === "guest" ? "the guest" : "the customer";
  const rows: Row[] = [
    ["Order", ctx.orderNumber],
    ["Customer", ctx.buyerLabel],
    ["Total", money(ctx.total, ctx.currency)],
    ["Cancelled by", who],
    ["Payment", ctx.paymentContext],
    ["Cancelled at", ctx.cancelledAt]
  ];
  return {
    subject: `[MyPetMart] Order Cancelled — ${ctx.orderNumber}`,
    text: `Order ${ctx.orderNumber} was cancelled by ${who}.\n\n${rowsText(rows)}\n\nManage: ${adminOrderUrl(ctx.orderId)}`,
    html: shell("Order cancelled", rowsHtml(rows), adminOrderUrl(ctx.orderId))
  };
}

export function getAdminCommerceExceptionTemplate(ctx: {
  orderId: number;
  orderNumber: string;
  amount: string;
  currency: string;
  paymentStatus: string;
  commerceException: string;
}): EmailTemplate {
  const rows: Row[] = [
    ["Order", ctx.orderNumber],
    ["Amount", money(ctx.amount, ctx.currency)],
    ["Payment status", ctx.paymentStatus],
    ["Exception", ctx.commerceException]
  ];
  return {
    subject: `[MyPetMart] ACTION REQUIRED — Order ${ctx.orderNumber}`,
    text: `ACTION REQUIRED\n\nPayment was received but order ${ctx.orderNumber} could not be confirmed automatically and needs manual attention.\n\n${rowsText(rows)}\n\nManage: ${adminOrderUrl(ctx.orderId)}`,
    html: shell(
      "ACTION REQUIRED — order needs attention",
      `<p style="font-size: 13px; color: #35221b;">Payment was received but this order could not be confirmed automatically.</p>${rowsHtml(rows)}`,
      adminOrderUrl(ctx.orderId)
    )
  };
}

export function getAdminReturnRequestedTemplate(ctx: {
  orderId: number;
  orderNumber: string;
  returnNumber: string;
  buyerLabel: string;
  itemName: string;
  quantity: number;
  resolution: "refund" | "replacement";
  reason: string;
}): EmailTemplate {
  const rows: Row[] = [
    ["Return", ctx.returnNumber],
    ["Order", ctx.orderNumber],
    ["Customer", ctx.buyerLabel],
    ["Item", `${ctx.itemName} × ${ctx.quantity}`],
    ["Requested resolution", ctx.resolution],
    ["Reason", ctx.reason]
  ];
  return {
    subject: `[MyPetMart] New Return Request — ${ctx.orderNumber}`,
    text: `A return request was submitted.\n\n${rowsText(rows)}\n\nManage: ${adminOrderUrl(ctx.orderId)}`,
    html: shell("New return request", rowsHtml(rows), adminOrderUrl(ctx.orderId))
  };
}
