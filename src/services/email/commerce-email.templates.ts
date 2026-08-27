// Commerce-lifecycle transactional email templates (Order/Payment/Return/
// Refund/Replacement milestones). Kept in their own file, separate from
// email.templates.ts (auth/newsletter), since there are many of these and
// they share their own local layout helpers below. Branding matches the
// existing auth/newsletter templates exactly: cream body (#fff5e9), orange
// heading/CTA (#d65e2a), dark-brown copy (#35221b), terracotta accent
// (#bb5036) — see email.templates.ts for the precedent this follows.

export type EmailTemplate = { subject: string; text: string; html: string };

type OrderItemLine = { name: string; quantity: number; unitPrice: string; lineTotal: string };

function currencyPrefix(currency: string): string {
  return currency === "INR" ? "₹" : `${currency} `;
}

function money(amount: string, currency: string): string {
  return `${currencyPrefix(currency)}${amount}`;
}

function shell(bodyHtml: string): string {
  return `
    <div style="font-family: sans-serif; max-width: 500px; margin: 0 auto; padding: 24px; background: #fff5e9; border-radius: 16px; color: #35221b;">
      <h2 style="color: #d65e2a; margin-top: 0; font-family: 'Baloo 2', sans-serif;">MyPetMart</h2>
      ${bodyHtml}
      <hr style="border: 0; border-top: 1px solid #e5d5c5; margin: 24px 0;" />
      <p style="font-size: 12px; color: #888;">This is an automated message about your MyPetMart order. If you weren't expecting this, please contact MyPetMart support.</p>
    </div>
  `;
}

function ctaButton(url: string, label: string): string {
  return `
    <div style="text-align: center; margin: 24px 0;">
      <a href="${url}" style="display: inline-block; background: #d65e2a; color: #ffffff; font-weight: bold; text-decoration: none; padding: 12px 28px; border-radius: 999px; font-size: 14px;">${label}</a>
    </div>
  `;
}

function itemsTableHtml(items: OrderItemLine[], currency: string): string {
  const rows = items
    .map(
      (item) => `
        <tr>
          <td style="padding: 8px 0; font-size: 14px; color: #35221b;">${item.name} &times; ${item.quantity}</td>
          <td style="padding: 8px 0; font-size: 14px; color: #35221b; text-align: right;">${money(item.lineTotal, currency)}</td>
        </tr>`
    )
    .join("");
  return `<table style="width: 100%; border-collapse: collapse; margin: 12px 0;">${rows}</table>`;
}

function itemsTextLines(items: OrderItemLine[], currency: string): string {
  return items.map((item) => `- ${item.name} x${item.quantity}: ${money(item.lineTotal, currency)}`).join("\n");
}

// ---------------------------------------------------------------------------
// ORDER_PLACED / PAYMENT
// ---------------------------------------------------------------------------

export function getOrderPlacedTemplate(input: {
  orderNumber: string;
  items: OrderItemLine[];
  total: string;
  currency: string;
  shippingAddress: { recipientName: string; line1: string; line2: string | null; city: string; state: string; postalCode: string };
  viewOrderUrl: string | null;
}): EmailTemplate {
  const subject = `Order confirmed - ${input.orderNumber}`;
  const addressLine = [input.shippingAddress.line1, input.shippingAddress.line2, input.shippingAddress.city, input.shippingAddress.state, input.shippingAddress.postalCode]
    .filter(Boolean)
    .join(", ");
  const text = `Thanks for your order!\n\nOrder ${input.orderNumber} has been placed.\n\n${itemsTextLines(input.items, input.currency)}\n\nTotal: ${money(input.total, input.currency)}\n\nDelivering to:\n${input.shippingAddress.recipientName}\n${addressLine}\n${input.viewOrderUrl ? `\nView your order: ${input.viewOrderUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Thanks for your order!</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Order <strong>${input.orderNumber}</strong> has been placed.</p>
    ${itemsTableHtml(input.items, input.currency)}
    <p style="font-size: 14px; font-weight: bold; color: #35221b; text-align: right;">Total: ${money(input.total, input.currency)}</p>
    <p style="font-size: 13px; color: #35221b; margin-top: 20px;"><strong>Delivering to:</strong><br/>${input.shippingAddress.recipientName}<br/>${addressLine}</p>
    ${input.viewOrderUrl ? ctaButton(input.viewOrderUrl, "View Order") : ""}
  `);
  return { subject, text, html };
}

export function getPaymentSuccessfulTemplate(input: { orderNumber: string; amount: string; currency: string; viewOrderUrl: string | null }): EmailTemplate {
  const subject = `Payment received for ${input.orderNumber}`;
  const text = `Payment confirmed\n\nWe've received your payment of ${money(input.amount, input.currency)} for order ${input.orderNumber}.${input.viewOrderUrl ? `\n\nView your order: ${input.viewOrderUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Payment confirmed</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">We've received your payment of <strong>${money(input.amount, input.currency)}</strong> for order <strong>${input.orderNumber}</strong>.</p>
    ${input.viewOrderUrl ? ctaButton(input.viewOrderUrl, "View Order") : ""}
  `);
  return { subject, text, html };
}

export function getPaymentFailedTemplate(input: { orderNumber: string; amount: string; currency: string; retryUrl: string | null }): EmailTemplate {
  const subject = `We couldn't complete payment for ${input.orderNumber}`;
  const text = `Payment unsuccessful\n\nYour payment of ${money(input.amount, input.currency)} for order ${input.orderNumber} could not be completed. No amount has been charged. You're welcome to try again whenever you're ready.${input.retryUrl ? `\n\nRetry payment: ${input.retryUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Payment unsuccessful</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your payment of <strong>${money(input.amount, input.currency)}</strong> for order <strong>${input.orderNumber}</strong> could not be completed. No amount has been charged.</p>
    <p style="font-size: 14px; color: #35221b;">You're welcome to try again whenever you're ready.</p>
    ${input.retryUrl ? ctaButton(input.retryUrl, "Retry Payment") : ""}
  `);
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// ORDER FULFILMENT
// ---------------------------------------------------------------------------

export function getOrderProcessingTemplate(input: { orderNumber: string; viewOrderUrl: string | null }): EmailTemplate {
  const subject = `Order ${input.orderNumber} is being prepared`;
  const text = `Your order is being prepared\n\nOrder ${input.orderNumber} is now being packed for shipping.${input.viewOrderUrl ? `\n\nView your order: ${input.viewOrderUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Your order is being prepared</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Order <strong>${input.orderNumber}</strong> is now being packed for shipping.</p>
    ${input.viewOrderUrl ? ctaButton(input.viewOrderUrl, "View Order") : ""}
  `);
  return { subject, text, html };
}

export function getOrderShippedTemplate(input: { orderNumber: string; carrier: string | null; awbNumber: string | null; trackOrderUrl: string | null }): EmailTemplate {
  const subject = `Order ${input.orderNumber} has shipped`;
  const trackingLine = input.carrier && input.awbNumber ? `Carrier: ${input.carrier}\nTracking number: ${input.awbNumber}\n\n` : "";
  const text = `Your order is on its way\n\nOrder ${input.orderNumber} has shipped.\n\n${trackingLine}${input.trackOrderUrl ? `Track your order: ${input.trackOrderUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Your order is on its way</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Order <strong>${input.orderNumber}</strong> has shipped.</p>
    ${input.carrier && input.awbNumber ? `<p style="font-size: 13px; color: #35221b;"><strong>Carrier:</strong> ${input.carrier}<br/><strong>Tracking number:</strong> ${input.awbNumber}</p>` : ""}
    ${input.trackOrderUrl ? ctaButton(input.trackOrderUrl, "Track Order") : ""}
  `);
  return { subject, text, html };
}

export function getOrderOutForDeliveryTemplate(input: { orderNumber: string; trackOrderUrl: string | null }): EmailTemplate {
  const subject = `Order ${input.orderNumber} is out for delivery`;
  const text = `Arriving today\n\nOrder ${input.orderNumber} is out for delivery.${input.trackOrderUrl ? `\n\nTrack your order: ${input.trackOrderUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Arriving today</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Order <strong>${input.orderNumber}</strong> is out for delivery.</p>
    ${input.trackOrderUrl ? ctaButton(input.trackOrderUrl, "Track Order") : ""}
  `);
  return { subject, text, html };
}

export function getOrderDeliveredTemplate(input: { orderNumber: string; viewOrderUrl: string | null; returnEligible: boolean }): EmailTemplate {
  const subject = `Order ${input.orderNumber} has been delivered`;
  const returnLine = input.returnEligible ? "If anything isn't right, you can request a return or replacement from your order." : "";
  const text = `Delivered\n\nOrder ${input.orderNumber} has been delivered. We hope your pets love it!${returnLine ? `\n\n${returnLine}` : ""}${input.viewOrderUrl ? `\n\nView your order: ${input.viewOrderUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Delivered</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Order <strong>${input.orderNumber}</strong> has been delivered. We hope your pets love it!</p>
    ${returnLine ? `<p style="font-size: 14px; color: #35221b;">${returnLine}</p>` : ""}
    ${input.viewOrderUrl ? ctaButton(input.viewOrderUrl, "View Order") : ""}
  `);
  return { subject, text, html };
}

// Deliberately distinct subject/copy from getOrderShippedTemplate above —
// that one fires later, once the COURIER reports its own "picked up" scan
// (ShipmentModels/shipment.service.ts ingest()); this one fires the moment
// booking with iThink succeeds and an AWB exists (ShipmentService.create()),
// which happens first. Using the same "has shipped" wording for both would
// read as two identical, confusing emails at two different times.
export function getShipmentCreatedTemplate(input: { orderNumber: string; carrier: string | null; awbNumber: string | null; trackOrderUrl: string | null }): EmailTemplate {
  const subject = `Order ${input.orderNumber} — shipment booked`;
  const trackingLine = input.carrier && input.awbNumber ? `Carrier: ${input.carrier}\nTracking number: ${input.awbNumber}\n\n` : "";
  const text = `Shipment booked\n\nWe've booked a courier for order ${input.orderNumber}. We'll email you again once it's picked up.\n\n${trackingLine}${input.trackOrderUrl ? `Track your order: ${input.trackOrderUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Shipment booked</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">We've booked a courier for order <strong>${input.orderNumber}</strong>. We'll email you again once it's picked up.</p>
    ${input.carrier && input.awbNumber ? `<p style="font-size: 13px; color: #35221b;"><strong>Carrier:</strong> ${input.carrier}<br/><strong>Tracking number:</strong> ${input.awbNumber}</p>` : ""}
    ${input.trackOrderUrl ? ctaButton(input.trackOrderUrl, "Track Order") : ""}
  `);
  return { subject, text, html };
}

export function getOrderReturnedToOriginTemplate(input: { orderNumber: string; viewOrderUrl: string | null }): EmailTemplate {
  const subject = `Order ${input.orderNumber} is being returned to us`;
  const text = `Shipment returning to origin\n\nOrder ${input.orderNumber}'s shipment could not be delivered and is on its way back to us. We'll be in touch once it arrives.${input.viewOrderUrl ? `\n\nView your order: ${input.viewOrderUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Shipment returning to origin</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Order <strong>${input.orderNumber}</strong>'s shipment could not be delivered and is on its way back to us. We'll be in touch once it arrives.</p>
    ${input.viewOrderUrl ? ctaButton(input.viewOrderUrl, "View Order") : ""}
  `);
  return { subject, text, html };
}

// Deliberately generic — never includes the raw courier remark/reason text
// (NDR/delivery-exception messages from iThink can be internal logistics
// jargon, e.g. "Consignee refused", "ODA", not something to forward verbatim
// to a customer). Points them at tracking for whatever detail is safe to show.
export function getDeliveryAttemptFailedTemplate(input: { orderNumber: string; trackOrderUrl: string | null }): EmailTemplate {
  const subject = `Delivery attempt failed - Order ${input.orderNumber}`;
  const text = `Delivery attempt failed\n\nA delivery attempt for order ${input.orderNumber} was unsuccessful. The courier will typically retry.${input.trackOrderUrl ? `\n\nTrack your order: ${input.trackOrderUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Delivery attempt failed</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">A delivery attempt for order <strong>${input.orderNumber}</strong> was unsuccessful. The courier will typically retry.</p>
    ${input.trackOrderUrl ? ctaButton(input.trackOrderUrl, "Track Order") : ""}
  `);
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// RETURN
// ---------------------------------------------------------------------------

export function getReturnRequestedTemplate(input: { returnNumber: string; itemName: string; quantity: number; resolution: "refund" | "replacement" }): EmailTemplate {
  const subject = `Return request received - ${input.returnNumber}`;
  const text = `Return request received\n\nWe've received your request for ${input.itemName} (qty ${input.quantity}) as a ${input.resolution}.\n\nRequest: ${input.returnNumber}\nStatus: Requested\n\nWe'll email you once it's been reviewed.`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Return request received</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">We've received your request for <strong>${input.itemName}</strong> (qty ${input.quantity}) as a <strong>${input.resolution}</strong>.</p>
    <p style="font-size: 13px; color: #35221b;">Request: <strong>${input.returnNumber}</strong><br/>Status: Requested</p>
    <p style="font-size: 14px; color: #35221b;">We'll email you once it's been reviewed.</p>
  `);
  return { subject, text, html };
}

export function getReturnApprovedTemplate(input: { returnNumber: string; itemName: string }): EmailTemplate {
  const subject = `Return approved - ${input.returnNumber}`;
  const text = `Return approved\n\nYour return request ${input.returnNumber} for ${input.itemName} has been approved.`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Return approved</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your return request <strong>${input.returnNumber}</strong> for <strong>${input.itemName}</strong> has been approved.</p>
  `);
  return { subject, text, html };
}

export function getReturnRejectedTemplate(input: { returnNumber: string; itemName: string; reason: string | null }): EmailTemplate {
  const subject = `Update on your return - ${input.returnNumber}`;
  const text = `Return not approved\n\nYour return request ${input.returnNumber} for ${input.itemName} was not approved.${input.reason ? `\n\nReason: ${input.reason}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Return not approved</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your return request <strong>${input.returnNumber}</strong> for <strong>${input.itemName}</strong> was not approved.</p>
    ${input.reason ? `<p style="font-size: 13px; color: #35221b;"><strong>Reason:</strong> ${input.reason}</p>` : ""}
  `);
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// REFUND
// ---------------------------------------------------------------------------

export function getRefundInitiatedTemplate(input: { refundNumber: string; orderNumber: string; amount: string; currency: string }): EmailTemplate {
  const subject = `Refund initiated for ${input.orderNumber}`;
  const text = `Refund initiated\n\nWe've initiated a refund of ${money(input.amount, input.currency)} for order ${input.orderNumber} (${input.refundNumber}).\n\nYour bank or payment provider may take a few days to reflect this. We'll email you again once it's complete.`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Refund initiated</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">We've initiated a refund of <strong>${money(input.amount, input.currency)}</strong> for order <strong>${input.orderNumber}</strong> (${input.refundNumber}).</p>
    <p style="font-size: 14px; color: #35221b;">Your bank or payment provider may take a few days to reflect this. We'll email you again once it's complete.</p>
  `);
  return { subject, text, html };
}

export function getRefundSucceededTemplate(input: { refundNumber: string; orderNumber: string; amount: string; currency: string; providerReference: string | null }): EmailTemplate {
  const subject = `Refund completed for ${input.orderNumber}`;
  const text = `Refund completed\n\nYour refund of ${money(input.amount, input.currency)} for order ${input.orderNumber} (${input.refundNumber}) has been completed.${input.providerReference ? `\n\nReference: ${input.providerReference}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Refund completed</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your refund of <strong>${money(input.amount, input.currency)}</strong> for order <strong>${input.orderNumber}</strong> (${input.refundNumber}) has been completed.</p>
    ${input.providerReference ? `<p style="font-size: 13px; color: #35221b;"><strong>Reference:</strong> ${input.providerReference}</p>` : ""}
  `);
  return { subject, text, html };
}

export function getRefundFailedTemplate(input: { refundNumber: string; orderNumber: string; amount: string; currency: string }): EmailTemplate {
  const subject = `Refund needs review for ${input.orderNumber}`;
  const text = `Refund could not be completed\n\nWe were unable to complete your refund of ${money(input.amount, input.currency)} for order ${input.orderNumber} (${input.refundNumber}). No amount has been deducted further. Our team will review this and follow up.`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Refund could not be completed</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">We were unable to complete your refund of <strong>${money(input.amount, input.currency)}</strong> for order <strong>${input.orderNumber}</strong> (${input.refundNumber}).</p>
    <p style="font-size: 14px; color: #35221b;">Our team will review this and follow up — no further amount has been deducted.</p>
  `);
  return { subject, text, html };
}

// ---------------------------------------------------------------------------
// REPLACEMENT
// ---------------------------------------------------------------------------

export function getReplacementApprovedTemplate(input: { replacementNumber: string; itemName: string; quantity: number }): EmailTemplate {
  const subject = `Replacement approved - ${input.replacementNumber}`;
  const text = `Replacement approved\n\nYour replacement for ${input.itemName} (qty ${input.quantity}) has been approved and is being prepared.`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Replacement approved</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your replacement for <strong>${input.itemName}</strong> (qty ${input.quantity}) has been approved and is being prepared.</p>
  `);
  return { subject, text, html };
}

export function getReplacementStockUnavailableTemplate(input: { replacementNumber: string; itemName: string }): EmailTemplate {
  const subject = `Replacement update - ${input.replacementNumber}`;
  const text = `Replacement delayed\n\nYour replacement for ${input.itemName} is currently on hold because it's out of stock. We'll email you as soon as it's ready to ship.`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Replacement delayed</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your replacement for <strong>${input.itemName}</strong> is currently on hold because it's out of stock. We'll email you as soon as it's ready to ship.</p>
  `);
  return { subject, text, html };
}

export function getReplacementShippedTemplate(input: { replacementNumber: string; itemName: string; carrier: string | null; awbNumber: string | null; trackUrl: string | null }): EmailTemplate {
  const subject = `Replacement shipped - ${input.replacementNumber}`;
  const trackingLine = input.carrier && input.awbNumber ? `Carrier: ${input.carrier}\nTracking number: ${input.awbNumber}\n\n` : "";
  const text = `Your replacement is on its way\n\nYour replacement for ${input.itemName} has shipped.\n\n${trackingLine}${input.trackUrl ? `Track it: ${input.trackUrl}` : ""}`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Your replacement is on its way</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your replacement for <strong>${input.itemName}</strong> has shipped.</p>
    ${input.carrier && input.awbNumber ? `<p style="font-size: 13px; color: #35221b;"><strong>Carrier:</strong> ${input.carrier}<br/><strong>Tracking number:</strong> ${input.awbNumber}</p>` : ""}
    ${input.trackUrl ? ctaButton(input.trackUrl, "Track Replacement") : ""}
  `);
  return { subject, text, html };
}

export function getReplacementCompletedTemplate(input: { replacementNumber: string; itemName: string }): EmailTemplate {
  const subject = `Replacement delivered - ${input.replacementNumber}`;
  const text = `Replacement delivered\n\nYour replacement for ${input.itemName} has been delivered. We hope your pets love it!`;
  const html = shell(`
    <p style="font-size: 16px; line-height: 1.5; font-weight: bold; color: #35221b;">Replacement delivered</p>
    <p style="font-size: 14px; line-height: 1.5; color: #35221b;">Your replacement for <strong>${input.itemName}</strong> has been delivered. We hope your pets love it!</p>
  `);
  return { subject, text, html };
}
