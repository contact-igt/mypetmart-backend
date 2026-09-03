// Thin, per-milestone wrappers around NotificationService.notify for every
// Order/Payment/Return/Refund/Replacement/Shipment event MyPetMart sends a
// customer email for (see NOTIFICATION_EVENT_TYPE_VALUES). Every function
// here re-loads its entity fresh (a plain, non-transactional read) and
// re-verifies it is genuinely still in the expected state before building
// email content — callers are only ever expected to invoke these AFTER
// their own commerce transaction has committed (see the call sites in
// OrderModels/order.service.ts, PaymentModels/payment-finalization.service.ts,
// etc.), and speculatively (a caller may attempt a call whose target state
// didn't actually change on this particular invocation — the re-verify
// guards content correctness, NotificationService's durable dedupe guards
// against ever sending the same milestone twice).
import { environmentConfig } from "../../config/environment.config.js";
import { Order, OrderItem, Payment, Refund, Replacement, ReturnRequest, ReturnShipment, Shipment, User } from "../../database/tables/index.js";
import type { Order as OrderModel } from "../../database/tables/OrderTable/index.js";
import type { OrderItem as OrderItemModel } from "../../database/tables/OrderItemTable/index.js";
import { formatMoney } from "../../utils/product-money.js";
import { NotificationService } from "./notification.service.js";
import { AdminNotificationService } from "./admin-notification.service.js";
import * as templates from "../email/commerce-email.templates.js";
import * as adminTemplates from "../email/admin-email.templates.js";

// Operator-safe buyer label for an admin email — the customer's own name, or
// "Guest" for a guest Order. Never derived from, and never exposing, an email
// or any auth material.
async function buyerLabel(order: OrderModel): Promise<string> {
  if (order.user_id === null) return "Guest";
  const user = await User.findByPk(order.user_id);
  return user?.name?.trim() || "Customer";
}

function adminOrderContext(order: OrderModel, buyer: string): adminTemplates.AdminOrderContext {
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    buyerLabel: buyer,
    contactEmail: order.contact_email ?? "—",
    shipRecipient: order.ship_recipient_name,
    shipCity: order.ship_city,
    shipState: order.ship_state,
    shipPostalCode: order.ship_postal_code,
    total: formatMoney(order.total),
    currency: order.currency,
    orderStatus: order.status
  };
}

// A guest Order's deep link can only ever be built with the raw recovery
// token handed back at the moment it was minted (createOrder / a pending-
// Order reissue) — guest_access_token_hash is a one-way hash, by design, so
// no later code path can recover it. Every subsequent lifecycle email to a
// guest (payment/processing/shipped/delivered/...) therefore has no working
// deep link to offer and simply omits the CTA — this is an inherent
// consequence of the existing guest-auth design, not something to work
// around by weakening the token hashing.
function orderViewUrl(order: OrderModel, rawGuestToken?: string): string | null {
  if (order.user_id !== null) {
    return `${environmentConfig.STOREFRONT_ORIGIN}/account/orders/${order.id}`;
  }
  if (rawGuestToken) {
    return `${environmentConfig.STOREFRONT_ORIGIN}/order/guest/${rawGuestToken}`;
  }
  return null;
}

function itemLabel(item: OrderItemModel): string {
  return item.variant_name ? `${item.product_name} - ${item.variant_name}` : item.product_name;
}

async function loadOrderAndItem(orderId: number, orderItemId: number): Promise<{ order: OrderModel; orderItem: OrderItemModel } | null> {
  const [order, orderItem] = await Promise.all([Order.findByPk(orderId), OrderItem.findByPk(orderItemId)]);
  if (!order || !orderItem) return null;
  return { order, orderItem };
}

export const CommerceNotifications = {
  /** Fires once per genuinely new Order (never for the "reissue guest access token" re-entry branch of createOrder). */
  async orderPlaced(orderId: number, rawGuestToken?: string): Promise<void> {
    const order = await Order.findByPk(orderId);
    if (!order) return;
    const items = await OrderItem.findAll({ where: { order_id: orderId }, order: [["id", "ASC"]] });
    await NotificationService.notify({
      eventType: "ORDER_PLACED",
      entityType: "order",
      entityId: order.id,
      recipientEmail: order.contact_email,
      build: () =>
        templates.getOrderPlacedTemplate({
          orderNumber: order.order_number,
          items: items.map((item) => ({ name: itemLabel(item), quantity: item.quantity, unitPrice: formatMoney(item.unit_price), lineTotal: formatMoney(item.line_total) })),
          total: formatMoney(order.total),
          currency: order.currency,
          shippingAddress: {
            recipientName: order.ship_recipient_name,
            line1: order.ship_line_1,
            line2: order.ship_line_2,
            city: order.ship_city,
            state: order.ship_state,
            postalCode: order.ship_postal_code
          },
          viewOrderUrl: orderViewUrl(order, rawGuestToken)
        })
    });

    await AdminNotificationService.notify({
      eventType: "ADMIN_ORDER_PLACED",
      entityType: "order",
      entityId: order.id,
      build: async () => {
        const fresh = await Order.findByPk(orderId);
        if (!fresh || fresh.status !== "pending") return null;
        const codPayment = await Payment.findOne({ where: { order_id: orderId, provider: "cod" } });
        const payuPayment = codPayment ? null : await Payment.findOne({ where: { order_id: orderId, provider: "payu" } });
        const paymentMethodLabel = codPayment ? "Cash on Delivery" : payuPayment ? "PayU — Pending" : "Not selected yet";
        return adminTemplates.getAdminNewOrderTemplate({ ...adminOrderContext(fresh, await buyerLabel(fresh)), paymentMethodLabel });
      }
    });
  },

  /**
   * Dedup is per-Order, not per-Payment-attempt: several attempts can exist
   * for the same Order (retries), but a customer should only ever get one
   * "payment successful" email for it — whichever attempt first finalizes
   * successfully sends it. Fires for both SUCCESS_CONFIRMED and
   * SUCCESS_COMMERCE_EXCEPTION (money was genuinely captured in both) — see
   * payment-finalization.service.ts.
   */
  async paymentSuccessful(orderId: number, paymentId: number): Promise<void> {
    const order = await Order.findByPk(orderId);
    if (!order || order.payment_status !== "paid") return;
    const payment = await Payment.findByPk(paymentId);
    if (!payment) return;
    await NotificationService.notify({
      eventType: "PAYMENT_SUCCESSFUL",
      entityType: "order",
      entityId: order.id,
      recipientEmail: order.contact_email,
      build: () => templates.getPaymentSuccessfulTemplate({ orderNumber: order.order_number, amount: formatMoney(payment.amount), currency: payment.currency, viewOrderUrl: orderViewUrl(order) })
    });

    // A verified capture that could NOT confirm the Order (inventory/state
    // exception) is a high-priority manual-attention alert, not a routine
    // "payment received" — deduped separately (ADMIN_COMMERCE_EXCEPTION).
    if (order.commerce_exception) {
      await AdminNotificationService.notify({
        eventType: "ADMIN_COMMERCE_EXCEPTION",
        entityType: "order",
        entityId: order.id,
        build: async () => {
          const fresh = await Order.findByPk(orderId);
          if (!fresh || fresh.payment_status !== "paid" || !fresh.commerce_exception) return null;
          return adminTemplates.getAdminCommerceExceptionTemplate({
            orderId: fresh.id,
            orderNumber: fresh.order_number,
            amount: formatMoney(payment.amount),
            currency: payment.currency,
            paymentStatus: fresh.payment_status,
            commerceException: fresh.commerce_exception
          });
        }
      });
      return;
    }

    await AdminNotificationService.notify({
      eventType: "ADMIN_PAYMENT_RECEIVED",
      entityType: "order",
      entityId: order.id,
      build: async () => {
        const fresh = await Order.findByPk(orderId);
        if (!fresh || fresh.payment_status !== "paid") return null;
        return adminTemplates.getAdminPaymentReceivedTemplate({
          orderId: fresh.id,
          orderNumber: fresh.order_number,
          buyerLabel: await buyerLabel(fresh),
          amount: formatMoney(payment.amount),
          currency: payment.currency,
          provider: payment.provider,
          providerReference: payment.provider_payment_id ?? payment.provider_order_id,
          orderStatus: fresh.status,
          paymentStatus: fresh.payment_status
        });
      }
    });
  },

  /** Dedup is per-Payment-attempt: each distinct failed retry is its own real, customer-meaningful event (unlike success, which is order-scoped). */
  async paymentFailed(paymentId: number): Promise<void> {
    const payment = await Payment.findByPk(paymentId);
    if (!payment || payment.status !== "failed") return;
    const order = await Order.findByPk(payment.order_id);
    if (!order) return;
    await NotificationService.notify({
      eventType: "PAYMENT_FAILED",
      entityType: "payment",
      entityId: payment.id,
      recipientEmail: order.contact_email,
      build: () => templates.getPaymentFailedTemplate({ orderNumber: order.order_number, amount: formatMoney(payment.amount), currency: payment.currency, retryUrl: orderViewUrl(order) })
    });

    // Deduped per failed attempt (entity = payment.id), so a duplicate
    // callback for the same attempt never re-emails, while a genuinely new
    // failed retry is its own alert.
    await AdminNotificationService.notify({
      eventType: "ADMIN_PAYMENT_FAILED",
      entityType: "payment",
      entityId: payment.id,
      build: async () => {
        const fresh = await Payment.findByPk(paymentId);
        if (!fresh || fresh.status !== "failed") return null;
        return adminTemplates.getAdminPaymentFailedTemplate({
          orderId: order.id,
          orderNumber: order.order_number,
          amount: formatMoney(fresh.amount),
          currency: fresh.currency,
          provider: fresh.provider,
          providerReference: fresh.provider_order_id,
          attemptStatus: fresh.status
        });
      }
    });
  },

  async orderProcessing(orderId: number): Promise<void> {
    const order = await Order.findByPk(orderId);
    if (!order || order.status !== "processing") return;
    await NotificationService.notify({
      eventType: "ORDER_PROCESSING",
      entityType: "order",
      entityId: order.id,
      recipientEmail: order.contact_email,
      build: () => templates.getOrderProcessingTemplate({ orderNumber: order.order_number, viewOrderUrl: orderViewUrl(order) })
    });

    await AdminNotificationService.notify({
      eventType: "ADMIN_ORDER_PROCESSING",
      entityType: "order",
      entityId: order.id,
      build: async () => {
        const fresh = await Order.findByPk(orderId);
        if (!fresh || fresh.status !== "processing") return null;
        return adminTemplates.getAdminOrderStatusTemplate({ orderId: fresh.id, orderNumber: fresh.order_number, buyerLabel: await buyerLabel(fresh), newStatus: "processing" });
      }
    });
  },

  /**
   * order.status can reach "shipped" via two independent paths — an admin
   * manually advancing it (AdminOrderService.updateStatus/bulkUpdateStatus)
   * or the real courier tracking sync auto-advancing it (ShipmentModels/
   * shipment.service.ts applyFulfilment, when a courier reports picked_up/
   * in_transit/out_for_delivery). Both call this same function; the
   * durable per-Order dedup guarantees only the first to actually persist
   * the transition sends an email, regardless of which path won.
   */
  async orderShipped(orderId: number): Promise<void> {
    const order = await Order.findByPk(orderId);
    if (!order || order.status !== "shipped") return;
    const shipment = await Shipment.findOne({ where: { source_type: "order", source_id: orderId } });
    await NotificationService.notify({
      eventType: "ORDER_SHIPPED",
      entityType: "order",
      entityId: order.id,
      recipientEmail: order.contact_email,
      build: () =>
        templates.getOrderShippedTemplate({ orderNumber: order.order_number, carrier: shipment?.carrier ?? null, awbNumber: shipment?.tracking_number ?? null, trackOrderUrl: orderViewUrl(order) })
    });

    await AdminNotificationService.notify({
      eventType: "ADMIN_ORDER_SHIPPED",
      entityType: "order",
      entityId: order.id,
      build: async () => {
        const fresh = await Order.findByPk(orderId);
        if (!fresh || fresh.status !== "shipped") return null;
        return adminTemplates.getAdminOrderStatusTemplate({
          orderId: fresh.id, orderNumber: fresh.order_number, buyerLabel: await buyerLabel(fresh),
          newStatus: "shipped", carrier: shipment?.carrier ?? null, awbNumber: shipment?.tracking_number ?? null
        });
      }
    });
  },

  /** ORDER_OUT_FOR_DELIVERY has no Order.status equivalent — it only exists as a real Shipment.status value, so this is keyed by shipment, not order. */
  async orderOutForDelivery(shipmentId: number): Promise<void> {
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment || shipment.source_type !== "order" || shipment.status !== "out_for_delivery") return;
    const order = await Order.findByPk(shipment.order_id);
    if (!order) return;
    await NotificationService.notify({
      eventType: "ORDER_OUT_FOR_DELIVERY",
      entityType: "shipment",
      entityId: shipment.id,
      recipientEmail: order.contact_email,
      build: () => templates.getOrderOutForDeliveryTemplate({ orderNumber: order.order_number, trackOrderUrl: orderViewUrl(order) })
    });
  },

  /** Same dual-path note as orderShipped above — admin manual set OR courier-sync auto-advance both converge here. */
  async orderDelivered(orderId: number): Promise<void> {
    const order = await Order.findByPk(orderId);
    if (!order || (order.status !== "delivered" && order.status !== "return_requested")) return;
    await NotificationService.notify({
      eventType: "ORDER_DELIVERED",
      entityType: "order",
      entityId: order.id,
      recipientEmail: order.contact_email,
      build: () => templates.getOrderDeliveredTemplate({ orderNumber: order.order_number, viewOrderUrl: orderViewUrl(order), returnEligible: true })
    });

    await AdminNotificationService.notify({
      eventType: "ADMIN_ORDER_DELIVERED",
      entityType: "order",
      entityId: order.id,
      build: async () => {
        const fresh = await Order.findByPk(orderId);
        if (!fresh || (fresh.status !== "delivered" && fresh.status !== "return_requested")) return null;
        return adminTemplates.getAdminOrderStatusTemplate({ orderId: fresh.id, orderNumber: fresh.order_number, buyerLabel: await buyerLabel(fresh), newStatus: "delivered" });
      }
    });
  },

  /**
   * Fires once a Shipment genuinely has an AWB (ShipmentService.create()'s
   * success path, called after that transaction commits) — distinct from
   * orderShipped below, which instead fires later once the COURIER reports
   * its own "picked up" scan (ingest()). Re-verifies tracking_number is
   * actually set before sending: create() calls this unconditionally after
   * its AWB-persistence transaction, including the "accepted without AWB,
   * reconciliation required" outcome, which must not email a tracking
   * number that doesn't exist. Order-sourced only, matching this module's
   * existing order-vs-replacement split (replacementShipped is the
   * Replacement-side equivalent, fired at the same courier-pickup point
   * orderShipped uses — this module does not yet have a Replacement
   * equivalent of "booked", matching the same asymmetry already present
   * before this addition).
   */
  async shipmentCreated(shipmentId: number): Promise<void> {
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment || shipment.source_type !== "order" || !shipment.tracking_number) return;
    const order = await Order.findByPk(shipment.order_id);
    if (!order) return;
    await NotificationService.notify({
      eventType: "SHIPMENT_CREATED",
      entityType: "shipment",
      entityId: shipment.id,
      recipientEmail: order.contact_email,
      build: () => templates.getShipmentCreatedTemplate({ orderNumber: order.order_number, carrier: shipment.carrier, awbNumber: shipment.tracking_number, trackOrderUrl: orderViewUrl(order) })
    });

    await AdminNotificationService.notify({
      eventType: "ADMIN_SHIPMENT_CREATED",
      entityType: "shipment",
      entityId: shipment.id,
      build: async () => {
        const fresh = await Shipment.findByPk(shipmentId);
        if (!fresh || fresh.source_type !== "order" || !fresh.tracking_number) return null;
        return adminTemplates.getAdminShipmentCreatedTemplate({
          orderId: order.id, orderNumber: order.order_number, shipmentId: fresh.id,
          carrier: fresh.carrier, awbNumber: fresh.tracking_number, shipmentStatus: fresh.status,
          shipRecipient: order.ship_recipient_name, shipPostalCode: order.ship_postal_code
        });
      }
    });
  },

  /** Fires once a Shipment's tracking first reports RTO initiated — called from ingest()'s notification block, same order-sourced scope as orderShipped/orderOutForDelivery/orderDelivered in that same block. */
  async orderReturnedToOrigin(shipmentId: number): Promise<void> {
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment || shipment.source_type !== "order" || shipment.status !== "rto_initiated") return;
    const order = await Order.findByPk(shipment.order_id);
    if (!order) return;
    await NotificationService.notify({
      eventType: "SHIPMENT_RTO_INITIATED",
      entityType: "shipment",
      entityId: shipment.id,
      recipientEmail: order.contact_email,
      build: () => templates.getOrderReturnedToOriginTemplate({ orderNumber: order.order_number, viewOrderUrl: orderViewUrl(order) })
    });
  },

  /**
   * Fires on a failed delivery attempt ("ndr") or a courier-reported
   * delivery exception — both collapse into the same customer-facing event
   * (SHIPMENT_DELIVERY_FAILED), so a shipment that later toggles between the
   * two (e.g. ndr -> delivery_exception on a retry) still only ever emails
   * once, per NotificationService's per-(event,entity) dedupe — the same
   * "several distinct transitions, one email" precedent orderShipped above
   * already establishes for picked_up/in_transit/out_for_delivery.
   */
  async deliveryAttemptFailed(shipmentId: number): Promise<void> {
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment || shipment.source_type !== "order" || (shipment.status !== "ndr" && shipment.status !== "delivery_exception")) return;
    const order = await Order.findByPk(shipment.order_id);
    if (!order) return;
    await NotificationService.notify({
      eventType: "SHIPMENT_DELIVERY_FAILED",
      entityType: "shipment",
      entityId: shipment.id,
      recipientEmail: order.contact_email,
      build: () => templates.getDeliveryAttemptFailedTemplate({ orderNumber: order.order_number, trackOrderUrl: orderViewUrl(order) })
    });
  },

  async returnRequested(returnRequestId: number): Promise<void> {
    const returnRequest = await ReturnRequest.findByPk(returnRequestId);
    if (!returnRequest) return;
    const loaded = await loadOrderAndItem(returnRequest.order_id, returnRequest.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "RETURN_REQUESTED",
      entityType: "return",
      entityId: returnRequest.id,
      recipientEmail: loaded.order.contact_email,
      build: () =>
        templates.getReturnRequestedTemplate({
          returnNumber: returnRequest.return_number,
          itemName: itemLabel(loaded.orderItem),
          quantity: returnRequest.quantity,
          resolution: returnRequest.type === "replacement" ? "replacement" : "refund"
        })
    });

    await AdminNotificationService.notify({
      eventType: "ADMIN_RETURN_REQUESTED",
      entityType: "return",
      entityId: returnRequest.id,
      build: async () => {
        const fresh = await ReturnRequest.findByPk(returnRequestId);
        if (!fresh) return null;
        return adminTemplates.getAdminReturnRequestedTemplate({
          orderId: loaded.order.id,
          orderNumber: loaded.order.order_number,
          returnNumber: fresh.return_number,
          buyerLabel: await buyerLabel(loaded.order),
          itemName: itemLabel(loaded.orderItem),
          quantity: fresh.quantity,
          resolution: fresh.type === "replacement" ? "replacement" : "refund",
          reason: fresh.reason
        });
      }
    });
  },

  async returnApproved(returnRequestId: number): Promise<void> {
    const returnRequest = await ReturnRequest.findByPk(returnRequestId);
    if (!returnRequest || returnRequest.status !== "approved") return;
    const loaded = await loadOrderAndItem(returnRequest.order_id, returnRequest.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "RETURN_APPROVED",
      entityType: "return",
      entityId: returnRequest.id,
      recipientEmail: loaded.order.contact_email,
      build: () => templates.getReturnApprovedTemplate({ returnNumber: returnRequest.return_number, itemName: itemLabel(loaded.orderItem) })
    });
  },

  async returnRejected(returnRequestId: number): Promise<void> {
    const returnRequest = await ReturnRequest.findByPk(returnRequestId);
    if (!returnRequest || returnRequest.status !== "rejected") return;
    const loaded = await loadOrderAndItem(returnRequest.order_id, returnRequest.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "RETURN_REJECTED",
      entityType: "return",
      entityId: returnRequest.id,
      recipientEmail: loaded.order.contact_email,
      build: () => templates.getReturnRejectedTemplate({ returnNumber: returnRequest.return_number, itemName: itemLabel(loaded.orderItem), reason: returnRequest.resolution_note })
    });
  },

  async refundInitiated(refundId: number): Promise<void> {
    const refund = await Refund.findByPk(refundId);
    if (!refund) return;
    const order = await Order.findByPk(refund.order_id);
    if (!order) return;
    await NotificationService.notify({
      eventType: "REFUND_INITIATED",
      entityType: "refund",
      entityId: refund.id,
      recipientEmail: order.contact_email,
      build: () => templates.getRefundInitiatedTemplate({ refundNumber: refund.refund_number, orderNumber: order.order_number, amount: formatMoney(refund.amount), currency: refund.currency })
    });
  },

  async refundSucceeded(refundId: number): Promise<void> {
    const refund = await Refund.findByPk(refundId);
    if (!refund || refund.status !== "succeeded") return;
    const order = await Order.findByPk(refund.order_id);
    if (!order) return;
    await NotificationService.notify({
      eventType: "REFUND_SUCCEEDED",
      entityType: "refund",
      entityId: refund.id,
      recipientEmail: order.contact_email,
      build: () =>
        templates.getRefundSucceededTemplate({
          refundNumber: refund.refund_number,
          orderNumber: order.order_number,
          amount: formatMoney(refund.amount),
          currency: refund.currency,
          providerReference: refund.provider_refund_id
        })
    });
  },

  async refundFailed(refundId: number): Promise<void> {
    const refund = await Refund.findByPk(refundId);
    if (!refund || refund.status !== "failed") return;
    const order = await Order.findByPk(refund.order_id);
    if (!order) return;
    await NotificationService.notify({
      eventType: "REFUND_FAILED",
      entityType: "refund",
      entityId: refund.id,
      recipientEmail: order.contact_email,
      build: () => templates.getRefundFailedTemplate({ refundNumber: refund.refund_number, orderNumber: order.order_number, amount: formatMoney(refund.amount), currency: refund.currency })
    });
  },

  /** Fires both from initial approval-with-stock-available and from the later "stock replenished" admin resolution (ReplacementModels/replacement.service.ts updateStatus) — dedup by replacement.id keeps this to exactly one email either way. */
  async replacementApproved(replacementId: number): Promise<void> {
    const replacement = await Replacement.findByPk(replacementId);
    if (!replacement || replacement.status !== "processing") return;
    const loaded = await loadOrderAndItem(replacement.order_id, replacement.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "REPLACEMENT_APPROVED",
      entityType: "replacement",
      entityId: replacement.id,
      recipientEmail: loaded.order.contact_email,
      build: () => templates.getReplacementApprovedTemplate({ replacementNumber: replacement.replacement_number, itemName: itemLabel(loaded.orderItem), quantity: replacement.quantity })
    });
  },

  async replacementStockUnavailable(replacementId: number): Promise<void> {
    const replacement = await Replacement.findByPk(replacementId);
    if (!replacement || replacement.status !== "stock_unavailable") return;
    const loaded = await loadOrderAndItem(replacement.order_id, replacement.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "REPLACEMENT_STOCK_UNAVAILABLE",
      entityType: "replacement",
      entityId: replacement.id,
      recipientEmail: loaded.order.contact_email,
      build: () => templates.getReplacementStockUnavailableTemplate({ replacementNumber: replacement.replacement_number, itemName: itemLabel(loaded.orderItem) })
    });
  },

  /** "Shipped" for a Replacement is mapped to its linked Shipment reaching "picked_up" — SHIPMENT_STATUS_VALUES has no literal "shipped" value; picked_up is the real signal that the courier physically has the package. */
  async replacementShipped(shipmentId: number): Promise<void> {
    const shipment = await Shipment.findByPk(shipmentId);
    if (!shipment || shipment.source_type !== "replacement" || !shipment.replacement_id) return;
    const replacement = await Replacement.findByPk(shipment.replacement_id);
    if (!replacement) return;
    const loaded = await loadOrderAndItem(replacement.order_id, replacement.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "REPLACEMENT_SHIPPED",
      entityType: "shipment",
      entityId: shipment.id,
      recipientEmail: loaded.order.contact_email,
      build: () =>
        templates.getReplacementShippedTemplate({
          replacementNumber: replacement.replacement_number,
          itemName: itemLabel(loaded.orderItem),
          carrier: shipment.carrier,
          awbNumber: shipment.tracking_number,
          trackUrl: orderViewUrl(loaded.order)
        })
    });
  },

  /** Fires once a reverse pickup genuinely has an AWB (ReturnShipmentService.createForApprovedReturn's success path). */
  async returnPickupCreated(returnShipmentId: number): Promise<void> {
    const returnShipment = await ReturnShipment.findByPk(returnShipmentId);
    if (!returnShipment || !returnShipment.awb_number) return;
    const returnRequest = await ReturnRequest.findByPk(returnShipment.return_request_id);
    if (!returnRequest) return;
    const loaded = await loadOrderAndItem(returnRequest.order_id, returnRequest.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "RETURN_PICKUP_CREATED",
      entityType: "return_shipment",
      entityId: returnShipment.id,
      recipientEmail: loaded.order.contact_email,
      build: () => templates.getReturnPickupCreatedTemplate({ returnNumber: returnRequest.return_number, itemName: itemLabel(loaded.orderItem), carrier: returnShipment.carrier, awbNumber: returnShipment.awb_number })
    });
  },

  /** Courier-reported pickup — fires from the same tracking-sync ingest path ORDER_SHIPPED/orderShipped uses on the forward side. */
  async returnPickedUp(returnShipmentId: number): Promise<void> {
    const returnShipment = await ReturnShipment.findByPk(returnShipmentId);
    if (!returnShipment || returnShipment.status !== "picked_up") return;
    const returnRequest = await ReturnRequest.findByPk(returnShipment.return_request_id);
    if (!returnRequest) return;
    const loaded = await loadOrderAndItem(returnRequest.order_id, returnRequest.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "RETURN_PICKED_UP",
      entityType: "return_shipment",
      entityId: returnShipment.id,
      recipientEmail: loaded.order.contact_email,
      build: () => templates.getReturnPickedUpTemplate({ returnNumber: returnRequest.return_number, itemName: itemLabel(loaded.orderItem) })
    });
  },

  /**
   * Courier-reported arrival at the warehouse — informational only. Never
   * implies a refund has started; that stays a separate, manual admin
   * action gated on ReturnRequest.item_received_at (see return.service.ts),
   * which this notification does not touch.
   */
  async returnDelivered(returnShipmentId: number): Promise<void> {
    const returnShipment = await ReturnShipment.findByPk(returnShipmentId);
    if (!returnShipment || returnShipment.status !== "delivered") return;
    const returnRequest = await ReturnRequest.findByPk(returnShipment.return_request_id);
    if (!returnRequest) return;
    const loaded = await loadOrderAndItem(returnRequest.order_id, returnRequest.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "RETURN_DELIVERED",
      entityType: "return_shipment",
      entityId: returnShipment.id,
      recipientEmail: loaded.order.contact_email,
      build: () => templates.getReturnDeliveredTemplate({ returnNumber: returnRequest.return_number, itemName: itemLabel(loaded.orderItem) })
    });
  },

  async replacementCompleted(replacementId: number): Promise<void> {
    const replacement = await Replacement.findByPk(replacementId);
    if (!replacement || replacement.status !== "completed") return;
    const loaded = await loadOrderAndItem(replacement.order_id, replacement.order_item_id);
    if (!loaded) return;
    await NotificationService.notify({
      eventType: "REPLACEMENT_COMPLETED",
      entityType: "replacement",
      entityId: replacement.id,
      recipientEmail: loaded.order.contact_email,
      build: () => templates.getReplacementCompletedTemplate({ replacementNumber: replacement.replacement_number, itemName: itemLabel(loaded.orderItem) })
    });
  },

  // ---------------------------------------------------------------------------
  // Admin-only operational events (no existing customer email for these)
  // ---------------------------------------------------------------------------

  /**
   * COD Order confirmed — admin-only. Called from PaymentService.confirmCodOrder
   * AFTER its transaction commits (Order pending -> confirmed, stock + Cart
   * finalized). Re-verifies the Order is genuinely confirmed with a pending
   * COD Payment before sending, and never labels COD as "paid".
   */
  async codOrderConfirmed(orderId: number): Promise<void> {
    const order = await Order.findByPk(orderId);
    if (!order) return;
    await AdminNotificationService.notify({
      eventType: "ADMIN_COD_CONFIRMED",
      entityType: "order",
      entityId: order.id,
      build: async () => {
        const fresh = await Order.findByPk(orderId);
        if (!fresh || fresh.status === "pending" || fresh.status === "cancelled") return null;
        const codPayment = await Payment.findOne({ where: { order_id: orderId, provider: "cod" } });
        if (!codPayment || codPayment.status === "paid") return null;
        return adminTemplates.getAdminCodConfirmedTemplate(adminOrderContext(fresh, await buyerLabel(fresh)));
      }
    });
  },

  /**
   * Order cancelled — admin-only operational record, sent to the central
   * operations mailbox (never to individual admin accounts). Covers both an
   * admin-initiated cancel (AdminOrderService.updateStatus/bulkUpdateStatus)
   * and a customer/guest pending-Order self-service cancel
   * (OrderService.performPendingOrderCancellation). One cancellation per Order
   * (terminal state) so a single ADMIN_ORDER_CANCELLED claim covers it.
   */
  async orderCancelled(orderId: number, cancelledBy: "customer" | "guest" | "admin"): Promise<void> {
    const order = await Order.findByPk(orderId);
    if (!order || order.status !== "cancelled") return;
    await AdminNotificationService.notify({
      eventType: "ADMIN_ORDER_CANCELLED",
      entityType: "order",
      entityId: order.id,
      build: async () => {
        const fresh = await Order.findByPk(orderId);
        if (!fresh || fresh.status !== "cancelled") return null;
        const payments = await Payment.findAll({ where: { order_id: orderId }, order: [["id", "ASC"]] });
        const paid = payments.find((p) => p.status === "paid");
        const pendingOnline = payments.find((p) => p.status === "pending" && (p.provider === "payu" || p.provider === "breeze"));
        const failedOnline = payments.find((p) => p.status === "failed" || p.status === "cancelled");
        const paymentContext = paid
          ? "Was paid — refund handled via the admin/refund flow"
          : pendingOnline
          ? `Pending ${pendingOnline.provider} attempt (not captured)`
          : failedOnline
          ? `${failedOnline.provider} attempt did not complete`
          : "No payment attempt";
        return adminTemplates.getAdminOrderCancelledTemplate({
          orderId: fresh.id,
          orderNumber: fresh.order_number,
          buyerLabel: await buyerLabel(fresh),
          total: formatMoney(fresh.total),
          currency: fresh.currency,
          cancelledBy,
          paymentContext,
          cancelledAt: fresh.cancelled_at ? fresh.cancelled_at.toISOString() : "—"
        });
      }
    });
  }
};
