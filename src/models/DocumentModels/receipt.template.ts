import { MYPETMART_LOGO_DATA_URI, MYPETMART_LOGO_HEIGHT, MYPETMART_LOGO_WIDTH } from "./mypetmart-logo.js";
import type { StoreProfile } from "../SettingsModels/settings.types.js";
import type { CustomerReceiptJSON } from "./receipt.types.js";

// All text content below is either DB-sourced (product names, addresses,
// customer-entered values) or the store profile — never assume it's
// HTML-safe. page.setContent() (pdf-renderer.ts) genuinely interprets this
// as HTML, so an unescaped "<" in e.g. a product name would corrupt layout.
function escapeHtml(value: string): string {
  return value.replace(/&/gu, "&amp;").replace(/</gu, "&lt;").replace(/>/gu, "&gt;").replace(/"/gu, "&quot;").replace(/'/gu, "&#39;");
}

function formatDate(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return escapeHtml(iso);
  return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });
}

const PAYMENT_STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  paid: "Paid",
  failed: "Failed",
  refunded: "Refunded",
  cancelled: "Cancelled",
  partially_refunded: "Partially Refunded"
};

function itemsRows(receipt: CustomerReceiptJSON): string {
  return receipt.items
    .map(
      (item) => `
        <tr>
          <td>
            <div class="product-name">${escapeHtml(item.name)}</div>
            <div class="product-meta">SKU: ${escapeHtml(item.sku)}${item.variant ? ` &middot; ${escapeHtml(item.variant)}` : ""}</div>
          </td>
          <td class="num">${item.quantity}</td>
          <td class="num">&#8377;${escapeHtml(item.unitPrice)}</td>
          <td class="num">&#8377;${escapeHtml(item.lineTotal)}</td>
        </tr>`
    )
    .join("");
}

function refundRow(receipt: CustomerReceiptJSON): string {
  if (!receipt.refundSummary) return "";
  const label = receipt.refundSummary.status === "succeeded" ? "Refunded" : receipt.refundSummary.status === "processing" ? "Refund Processing" : "Refund Failed";
  return `
    <div class="totals-row">
      <span>${label}</span>
      <span>&#8377;${escapeHtml(receipt.refundSummary.refundedAmount)}</span>
    </div>`;
}

/**
 * Pure HTML-building function — no I/O, no DB access. Inline CSS only
 * (no external stylesheet) so pdf-renderer.ts's headless render never
 * depends on a network fetch succeeding.
 */
export function buildReceiptHtml(receipt: CustomerReceiptJSON, storeProfile: StoreProfile): string {
  const address = receipt.address;
  const addressLines = [address.line1, address.line2, `${address.city}, ${address.state} ${address.postalCode}`, address.country]
    .filter((line): line is string => Boolean(line && line.trim()))
    .map((line) => escapeHtml(line))
    .join("<br/>");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; }
  /* Explicit — never rely on an implicit background. Puppeteer's rendering
     surface has no fixed default; without this the document can render on a
     dark background depending on host environment/OS theme, which would
     leave the dark-brown text (#2b1c14) largely illegible. */
  html, body { background: #ffffff; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #2b1c14; font-size: 12px; }
  .sheet { padding: 8px; }
  .header { text-align: center; border-bottom: 2px solid #e2762f; padding-bottom: 18px; margin-bottom: 24px; }
  .header .logo { height: 42px; width: auto; display: block; margin: 0 auto 14px; }
  .doc-title { font-size: 18px; font-weight: 800; color: #2b1c14; margin: 0 0 8px; letter-spacing: 0.02em; }
  .doc-meta { font-size: 11px; color: #4a3a2f; }
  .doc-meta strong { color: #2b1c14; }
  .doc-meta .sep { margin: 0 10px; color: #d8c8bc; }
  .section { margin-bottom: 20px; }
  .section-title { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; color: #a1876f; margin-bottom: 8px; }
  .two-col { display: flex; gap: 32px; }
  .two-col > div { flex: 1; }
  .kv { font-size: 12px; line-height: 1.8; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  thead th { text-align: left; font-size: 10px; text-transform: uppercase; letter-spacing: 0.03em; color: #a1876f; border-bottom: 1px solid #e8ddd4; padding: 8px 6px; }
  thead th.num, td.num { text-align: right; }
  tbody td { padding: 10px 6px; border-bottom: 1px solid #f1ebe4; vertical-align: top; }
  .product-name { font-weight: 600; }
  .product-meta { font-size: 10px; color: #8a7565; margin-top: 2px; }
  .totals { margin-top: 16px; width: 260px; margin-left: auto; }
  .totals-row { display: flex; justify-content: space-between; padding: 4px 0; font-size: 12px; }
  .totals-row.grand { border-top: 2px solid #2b1c14; margin-top: 6px; padding-top: 8px; font-size: 14px; font-weight: 800; }
  .footer { margin-top: 32px; padding-top: 16px; border-top: 1px solid #e8ddd4; text-align: center; font-size: 11px; color: #8a7565; }
  .footer .thanks { font-weight: 700; color: #2b1c14; margin-bottom: 4px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; background: #fdeee1; color: #b5541c; font-size: 10px; font-weight: 700; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="header">
      <img class="logo" src="${MYPETMART_LOGO_DATA_URI}" width="${MYPETMART_LOGO_WIDTH}" height="${MYPETMART_LOGO_HEIGHT}" alt="${escapeHtml(storeProfile.storeName)}" />
      <h1 class="doc-title">Order Receipt</h1>
      <div class="doc-meta">
        <span><strong>Receipt No:</strong> ${escapeHtml(receipt.receiptNumber)}</span>
        <span class="sep">&middot;</span>
        <span><strong>Date:</strong> ${formatDate(receipt.receiptDate)}</span>
        <span class="sep">&middot;</span>
        <span><strong>Order No:</strong> ${escapeHtml(receipt.order.orderNumber)}</span>
      </div>
    </div>

    <div class="section two-col">
      <div>
        <div class="section-title">Customer Details</div>
        <div class="kv">
          ${escapeHtml(receipt.customer.name)}<br/>
          ${receipt.customer.email ? `${escapeHtml(receipt.customer.email)}<br/>` : ""}
          ${escapeHtml(receipt.customer.phone)}
        </div>
      </div>
      <div>
        <div class="section-title">Delivery Address</div>
        <div class="kv">
          ${escapeHtml(address.recipientName)}<br/>
          ${addressLines}<br/>
          ${escapeHtml(address.phone)}
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Items</div>
      <table>
        <thead>
          <tr>
            <th>Product</th>
            <th class="num">Qty</th>
            <th class="num">Price</th>
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          ${itemsRows(receipt)}
        </tbody>
      </table>
    </div>

    <div class="section two-col">
      <div>
        <div class="section-title">Payment</div>
        <div class="kv">
          Method: ${receipt.payment.method ? escapeHtml(receipt.payment.method) : "&mdash;"}<br/>
          Status: <span class="badge">${escapeHtml(PAYMENT_STATUS_LABELS[receipt.payment.status] ?? receipt.payment.status)}</span><br/>
          ${receipt.payment.transactionReference ? `Transaction Reference: ${escapeHtml(receipt.payment.transactionReference)}<br/>` : ""}
          ${receipt.payment.paidAt ? `Paid On: ${formatDate(receipt.payment.paidAt)}` : ""}
        </div>
      </div>
      <div>
        <div class="totals">
          <div class="totals-row"><span>Subtotal</span><span>&#8377;${escapeHtml(receipt.totals.subtotal)}</span></div>
          <div class="totals-row"><span>Shipping</span><span>&#8377;${escapeHtml(receipt.totals.shippingFee)}</span></div>
          ${refundRow(receipt)}
          <div class="totals-row grand"><span>Total Paid</span><span>&#8377;${escapeHtml(receipt.totals.total)}</span></div>
        </div>
      </div>
    </div>

    <div class="footer">
      <div class="thanks">Thank you for shopping with ${escapeHtml(storeProfile.storeName)}.</div>
      <div>
        For support, contact
        ${storeProfile.supportEmail ? escapeHtml(storeProfile.supportEmail) : ""}${storeProfile.supportEmail && storeProfile.supportPhone ? " or " : ""}${storeProfile.supportPhone ? escapeHtml(storeProfile.supportPhone) : ""}
      </div>
      <div style="margin-top: 6px;">This is a system-generated order receipt, not a GST tax invoice.</div>
    </div>
  </div>
</body>
</html>`;
}
