import crypto from "node:crypto";

import { UniqueConstraintError, type Transaction } from "sequelize";

import { shippingConfig } from "../../config/shipping.config.js";
import type { ReturnShipmentStatus } from "../../constants/database.constants.js";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Order, OrderItem, Product, ProductVariant, ReturnRequest, ReturnShipment, ReturnShipmentTrackingEvent } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { formatMoney } from "../../utils/product-money.js";
import { IThinkClient, IThinkClientError, type IThinkTrackingEvent } from "../ShipmentModels/ithink.client.js";
import { resolvePickupAddress, type ReturnPickupAddressJSON } from "../ReturnModels/return-pickup-address.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import {
  ReturnShipmentActionNotAllowedError,
  ReturnShipmentAlreadyExistsError,
  ReturnShipmentCourierSelectionInvalidError,
  ReturnShipmentNotEligibleError,
  ReturnShipmentNotFoundError,
  ReturnShipmentPackageDataError,
  ReturnShipmentProviderError,
  ReturnShipmentProviderNotConfiguredError,
  ReturnShipmentServiceabilityError
} from "./return-shipment.errors.js";
import type { CreateReturnShipmentSelectionInput, ReturnShipmentFailureReasonJSON, ReturnShipmentJSON, ReturnShipmentQuoteResultJSON } from "./return-shipment.types.js";

// Terminal — never advanced further, mirroring shipment.service.ts's own
// TERMINAL set for the same reason (idempotent create, monotonic sync).
const TERMINAL = new Set<ReturnShipmentStatus>(["delivered", "failed", "cancelled"]);
const FORWARD_RANK: Partial<Record<ReturnShipmentStatus, number>> = { pending: 0, approved: 1, pickup_scheduled: 2, picked_up: 3, in_transit: 4, delivered: 5 };
export const RETURN_SHIPMENT_BOOKING_IN_PROGRESS = "Booking in progress";

// A "Booking in progress" marker is written inside the create transaction and
// cleared (to "Accepted"/"failed") once the out-of-transaction iThink calls
// settle. If the process dies in between, the row is stranded at
// status="pending" / provider_status="Booking in progress" / awb_number=null
// with nothing to ever clear it — and the cancellation gate would then block
// the customer forever. A marker older than this window is treated as that
// abandoned attempt, not a live booking.
//
// Worst-case live booking = two sequential iThink calls (getReverseRates +
// createReverseShipment), each capped at ITHINK_TIMEOUT_MS (<= 60s), plus two
// short DB transactions — comfortably under two minutes. 15 minutes is an
// order of magnitude beyond that, so a live attempt is never misjudged stale;
// it also scales if ITHINK_TIMEOUT_MS is raised well above its default.
export const STALE_RETURN_BOOKING_MARKER_MS = Math.max(15 * 60_000, shippingConfig.timeoutMs * 20);

// True only for a booking marker that can no longer be completing: still
// pending, still no AWB persisted, and untouched past the staleness window.
// Anything with an AWB, or already failed/cancelled/advanced, is not a
// stranded marker and is left to the normal cancellation rules.
export function isStaleReturnBookingMarker(input: {
  status: ReturnShipmentStatus;
  providerStatus: string | null;
  awbNumber: string | null;
  updatedAt: Date | string;
}): boolean {
  if (input.status !== "pending" || input.providerStatus !== RETURN_SHIPMENT_BOOKING_IN_PROGRESS || input.awbNumber !== null) {
    return false;
  }
  const updatedMs = input.updatedAt instanceof Date ? input.updatedAt.getTime() : Date.parse(input.updatedAt);
  return Number.isFinite(updatedMs) && Date.now() - updatedMs >= STALE_RETURN_BOOKING_MARKER_MS;
}

/**
 * Maps iThink's raw scan-status strings to the requested 8-value reverse
 * vocabulary — deliberately coarser than SHIPMENT_STATUS_VALUES (no
 * rto-prefixed/ndr split): a reverse pickup has no "RTO of an RTO" concept, and every
 * courier-reported exception (undelivered pickup, lost, damaged, misrouted)
 * normalizes to "failed", the closest available meaning in the fixed
 * vocabulary Phase F.1 specifies. An unrecognized status falls back to
 * "pending", which canAdvanceReturnShipmentStatus's own monotonic check
 * then naturally refuses to apply as a regression — so an unmapped status
 * only ever affects the stored raw provider_status, never corrupts
 * normalized_status.
 */
export function normalizeIThinkReverseStatus(providerStatus: string): ReturnShipmentStatus {
  const status = providerStatus.trim().toLowerCase().replace(/^rev\s+/u, "");
  switch (status) {
    case "manifest":
    case "manifested":
    case "out for pick up":
    case "pickup scheduled": return "pickup_scheduled";
    case "picked up": return "picked_up";
    case "in transit":
    case "reached at destination": return "in_transit";
    case "out for delivery": return "in_transit";
    case "delivered": return "delivered";
    case "cancelled":
    case "canceled": return "cancelled";
    case "undelivered":
    case "not picked":
    case "out of delivery area":
    case "delayed":
    case "damaged":
    case "misrouted":
    case "lost":
    case "shortage": return "failed";
    default: return "pending";
  }
}

export type ReturnShipmentCancellationStage = "pre_pickup" | "picked_up" | "in_transit" | "out_for_delivery" | "delivered" | "closed" | "cancelled" | "failed" | "unknown";

/**
 * Provider-facing cancellation gate. This intentionally keeps the raw
 * provider vocabulary separate from the smaller local status enum: a reverse
 * shipment that has reached pickup or delivery must never be cancelled merely
 * because its local row has lagged behind tracking.
 */
export function classifyIThinkReverseCancellationStage(providerStatus: string | null, localStatus: ReturnShipmentStatus): ReturnShipmentCancellationStage {
  if (providerStatus) {
    const status = providerStatus.trim().toLowerCase().replace(/^rev\s+/u, "");
    if (["cancelled", "canceled"].includes(status)) return "cancelled";
    if (["manifest", "manifested", "accepted", "out for pick up", "pickup scheduled"].includes(status)) return "pre_pickup";
    if (status === "picked up") return "picked_up";
    if (status === "in transit" || status === "reached at destination") return "in_transit";
    if (status === "out for delivery") return "out_for_delivery";
    if (status === "delivered") return "delivered";
    if (status === "closed") return "closed";
    if (["undelivered", "not picked", "out of delivery area", "delayed", "damaged", "misrouted", "lost", "shortage", "failed"].includes(status)) return "failed";
    return "unknown";
  }

  if (["pending", "approved", "pickup_scheduled"].includes(localStatus)) return "pre_pickup";
  if (localStatus === "picked_up") return "picked_up";
  if (localStatus === "in_transit") return "in_transit";
  if (localStatus === "delivered") return "delivered";
  if (localStatus === "cancelled") return "cancelled";
  return "unknown";
}

export function canAdvanceReturnShipmentStatus(current: ReturnShipmentStatus, next: ReturnShipmentStatus): boolean {
  if (current === next) return false;
  if (TERMINAL.has(current)) return false;
  if (next === "failed" || next === "cancelled") return true;
  return (FORWARD_RANK[next] ?? -1) >= (FORWARD_RANK[current] ?? -1);
}

function providerDate(value: string): Date {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value) ? `${value.replace(" ", "T")}+05:30` : value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

function readFailureReason(returnShipment: ReturnShipment): ReturnShipmentFailureReasonJSON {
  let payload = returnShipment.raw_payload;
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return null; }
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.errorCode !== "string" || typeof record.message !== "string" || typeof record.failedAt !== "string") return null;
  return { provider: typeof record.provider === "string" ? record.provider : "ithink", errorCode: record.errorCode, message: record.message, failedAt: record.failedAt };
}

function toJSON(returnShipment: ReturnShipment): ReturnShipmentJSON {
  return {
    id: returnShipment.id,
    returnRequestId: returnShipment.return_request_id,
    shipmentNumber: returnShipment.shipment_number,
    provider: returnShipment.provider,
    carrier: returnShipment.carrier,
    awbNumber: returnShipment.awb_number,
    serviceType: returnShipment.service_type,
    shippingAmount: returnShipment.shipping_charge,
    currency: returnShipment.currency,
    status: returnShipment.status,
    providerStatus: returnShipment.provider_status,
    providerStatusCode: returnShipment.provider_status_code,
    failureReason: returnShipment.status === "failed" ? readFailureReason(returnShipment) : null,
    trackingUrl: returnShipment.tracking_url,
    pickedUpAt: returnShipment.picked_up_at?.toISOString() ?? null,
    deliveredAt: returnShipment.delivered_at?.toISOString() ?? null,
    cancelledAt: returnShipment.cancelled_at?.toISOString() ?? null,
    lastSyncedAt: returnShipment.last_synced_at?.toISOString() ?? null,
    createdAt: returnShipment.created_at.toISOString(),
    // Exposed so the return-cancellation eligibility check can age out a
    // stranded "Booking in progress" marker (see isStaleReturnBookingMarker).
    updatedAt: returnShipment.updated_at.toISOString(),
    trackingEvents: (returnShipment.trackingEvents ?? []).map((event) => ({
      id: event.id, status: event.normalized_status, providerStatus: event.provider_status, providerStatusCode: event.provider_status_code,
      location: event.location, message: event.message, eventAt: event.event_at.toISOString()
    }))
  };
}

function assertConfigured(): void {
  if (shippingConfig.provider !== "ithink" || !shippingConfig.ready || !shippingConfig.pickupAddressId || !shippingConfig.originPincode) throw new ReturnShipmentProviderNotConfiguredError();
}

async function markFailure(id: number, message: string, errorCode: string): Promise<void> {
  await ReturnShipment.update(
    { status: "failed", provider_status: errorCode, last_synced_at: new Date(), raw_payload: { provider: "ithink", errorCode, message, failedAt: new Date().toISOString() } },
    { where: { id } }
  );
}

/**
 * A ReturnRequest is always exactly one OrderItem + one quantity — unlike
 * forward Shipment's multi-line aggregate(), there is only ever one package
 * line to derive dimensions from here.
 */
async function derivePackage(orderItem: OrderItem, quantity: number, transaction: Transaction): Promise<{ weightGrams: number; lengthCm: string; widthCm: string; heightCm: string }> {
  if (orderItem.product_id === null) throw new ReturnShipmentPackageDataError(`Order item '${orderItem.id}' no longer has a product reference.`);
  const product = await Product.findByPk(orderItem.product_id, { transaction, paranoid: false });
  if (!product) throw new ReturnShipmentPackageDataError(`Shipping measurements are unavailable for order item '${orderItem.id}'.`);
  const variant = orderItem.product_variant_id === null ? null : await ProductVariant.findByPk(orderItem.product_variant_id, { transaction, paranoid: false });
  const weight = variant?.weight_grams ?? product.weight_grams;
  const length = Number(variant?.length_cm ?? product.length_cm);
  const width = Number(variant?.width_cm ?? product.width_cm);
  const height = Number(variant?.height_cm ?? product.height_cm);
  if (!weight || !Number.isFinite(length) || !Number.isFinite(width) || !Number.isFinite(height) || length <= 0 || width <= 0 || height <= 0) {
    throw new ReturnShipmentPackageDataError(`Order item '${orderItem.id}' is missing positive shipping measurements.`);
  }
  const weightGrams = weight * quantity;
  if (weightGrams > 10_000 || length > 1000 || width > 1000 || height * quantity > 1000) throw new ReturnShipmentPackageDataError("The package exceeds the iThink V3 domestic rate limits.");
  return { weightGrams, lengthCm: length.toFixed(2), widthCm: width.toFixed(2), heightCm: (height * quantity).toFixed(2) };
}

type ReverseShippable = {
  returnRequest: ReturnRequest;
  order: Order;
  orderItem: OrderItem;
  quantity: number;
  parcel: { weightGrams: number; lengthCm: string; widthCm: string; heightCm: string };
  pickup: ReturnPickupAddressJSON;
  existing: ReturnShipment | null;
};

/**
 * Eligibility + package + pickup-address resolution for a reverse pickup —
 * everything needed to know WHETHER and HOW a ReturnRequest can be shipped
 * back, with no ReturnShipment row created or mutated. Shared by
 * quoteForReturn() (stops here, only asks iThink for reverse rate
 * candidates) and createForApprovedReturn() (goes on to create/reuse a row
 * and book), so the two can never disagree about eligibility, the parcel, or
 * the pickup address.
 */
async function validateReverseShippable(returnRequestId: number, transaction: Transaction): Promise<ReverseShippable> {
  const returnRequest = await ReturnRequest.findByPk(returnRequestId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!returnRequest) throw new ReturnShipmentNotFoundError(returnRequestId);
  // Eligibility: only an approved return may have a reverse pickup booked
  // — mirrors the brief's own flow diagram (Return Approved -> Reverse
  // shipment created). "resolved"/"rejected"/"cancelled" have nothing left
  // to pick up.
  if (returnRequest.status !== "approved") {
    throw new ReturnShipmentNotEligibleError(`Return request '${returnRequestId}' must be approved before a return shipment can be created (current status: '${returnRequest.status}').`);
  }

  const existing = await ReturnShipment.findOne({ where: { return_request_id: returnRequestId }, transaction, lock: transaction.LOCK.UPDATE });
  // Unlike forward Shipment's prepare() (which silently reuses an
  // existing non-failed row for double-click safety), Phase F.1 lists
  // "duplicate creation prevented" as its own explicit, distinct test
  // requirement alongside eligibility — so a second attempt against a
  // return that already has a live (non-failed) return shipment is
  // rejected outright here, not silently absorbed. A genuinely failed
  // attempt is still retryable (see the `existing` reuse branch below).
  if (existing && existing.status !== "failed") {
    throw new ReturnShipmentAlreadyExistsError(returnRequestId);
  }

  const order = await Order.findByPk(returnRequest.order_id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!order) throw new ReturnShipmentNotEligibleError("The return's original Order was not found.");
  const orderItem = await OrderItem.findByPk(returnRequest.order_item_id, { transaction });
  if (!orderItem) throw new ReturnShipmentPackageDataError("The returned order item was not found.");

  const parcel = await derivePackage(orderItem, returnRequest.quantity, transaction);
  const pickup = resolvePickupAddress(returnRequest, order);
  return { returnRequest, order, orderItem, quantity: returnRequest.quantity, parcel, pickup, existing };
}

/**
 * Read-only reverse rate quote for an approved return — resolves
 * eligibility/package/pickup-address exactly like a booking would (via the
 * same validateReverseShippable()) but never touches the ReturnShipment
 * table. Returns every reverse-pickup-capable courier candidate iThink
 * offers for this pickup address, cheapest first. Nothing is persisted: the
 * admin's later selection is re-verified against a FRESH reverse rate check
 * in createForApprovedReturn(), so a quote going stale between "shown" and
 * "booked" fails safely rather than booking a no-longer-valid rate — the
 * same contract ShipmentService.quote() has for the forward flow.
 */
async function quoteForReturn(returnRequestId: number): Promise<ReturnShipmentQuoteResultJSON> {
  assertConfigured();
  const { orderItem, quantity, parcel, pickup } = await sequelize.transaction((transaction) => validateReverseShippable(returnRequestId, transaction));

  try {
    const rates = await IThinkClient.getReverseRates({
      fromPincode: pickup.postalCode, toPincode: shippingConfig.originPincode!,
      lengthCm: parcel.lengthCm, widthCm: parcel.widthCm, heightCm: parcel.heightCm,
      weightKg: (parcel.weightGrams / 1000).toFixed(3),
      productMrp: formatMoney(Number(orderItem.unit_price) * quantity)
    });
    return {
      options: [...rates]
        .sort((a, b) => Number(a.rate) - Number(b.rate))
        .map((rate) => ({ carrier: rate.courier, serviceType: rate.serviceType, rate: rate.rate, deliveryTat: rate.deliveryTat, estimatedDelivery: rate.estimatedDelivery }))
    };
  } catch (error) {
    // Mirrors ShipmentService.quote()'s own catch — a raw IThinkClientError
    // must surface as a real provider message, not a generic 500.
    if (error instanceof IThinkClientError) throw new ReturnShipmentProviderError(`ITHINK_${error.code}`, error.message);
    throw error;
  }
}

async function createForApprovedReturn(returnRequestId: number, selection?: CreateReturnShipmentSelectionInput): Promise<ReturnShipmentJSON> {
  assertConfigured();

  const prepared = await sequelize.transaction(async (transaction) => {
    const { order, orderItem, quantity, parcel, pickup, existing } = await validateReverseShippable(returnRequestId, transaction);

    if (existing) {
      existing.status = "pending";
      existing.provider_status = RETURN_SHIPMENT_BOOKING_IN_PROGRESS;
      existing.provider_status_code = null;
      existing.last_synced_at = null;
      existing.raw_payload = null;
      existing.weight_grams = parcel.weightGrams;
      existing.length_cm = parcel.lengthCm;
      existing.width_cm = parcel.widthCm;
      existing.height_cm = parcel.heightCm;
      await existing.save({ transaction });
      return { shipment: existing, order, orderItem, quantity, pickup };
    }

    const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.returnShipments, transaction);
    const shipment = await ReturnShipment.create({
      id, return_request_id: returnRequestId, shipment_number: buildBusinessReference("return_shipment", id),
      provider: "ithink", provider_order_id: null, carrier: null, awb_number: null, service_type: null,
      status: "pending", provider_status: RETURN_SHIPMENT_BOOKING_IN_PROGRESS, provider_status_code: null,
      weight_grams: parcel.weightGrams, length_cm: parcel.lengthCm, width_cm: parcel.widthCm, height_cm: parcel.heightCm,
      shipping_charge: null, currency: order.currency, tracking_url: null, raw_payload: null,
      picked_up_at: null, delivered_at: null, cancelled_at: null, last_synced_at: null
    }, { transaction });
    return { shipment, order, orderItem, quantity, pickup };
  });

  const { order, orderItem, pickup } = prepared;

  try {
    const rates = await IThinkClient.getReverseRates({
      fromPincode: pickup.postalCode, toPincode: shippingConfig.originPincode!,
      lengthCm: prepared.shipment.length_cm, widthCm: prepared.shipment.width_cm, heightCm: prepared.shipment.height_cm,
      weightKg: (prepared.shipment.weight_grams / 1000).toFixed(3),
      productMrp: formatMoney(Number(orderItem.unit_price) * prepared.quantity)
    });
    if (rates.length === 0) {
      await markFailure(prepared.shipment.id, `No reverse-pickup courier is currently serviceable for pincode ${pickup.postalCode}.`, "SERVICEABILITY_FAILED");
      throw new ReturnShipmentServiceabilityError();
    }
    const sorted = [...rates].sort((a, b) => Number(a.rate) - Number(b.rate));
    // Manual selection (from a prior return-shipment quote) is re-verified
    // against THIS fresh candidate list — never trusted from the quote
    // moment. No match (courier no longer reverse-capable/serviceable, or a
    // bogus pair) is a distinct, non-fallback failure: it must never
    // silently book the automatic cheapest instead of what the admin chose.
    // Omitting selection entirely keeps the original cheapest-pick path that
    // every prior caller (and the sync/retry paths) still take.
    let selected: (typeof sorted)[number] | undefined;
    if (selection) {
      selected = sorted.find((candidate) => candidate.courier.trim().toLowerCase() === selection.carrier.trim().toLowerCase() && candidate.serviceType === selection.serviceType);
      if (!selected) {
        await markFailure(prepared.shipment.id, "The selected reverse courier is no longer available.", "COURIER_SELECTION_INVALID");
        throw new ReturnShipmentCourierSelectionInvalidError();
      }
    } else {
      selected = sorted[0]!;
    }

    prepared.shipment.carrier = selected.courier;
    prepared.shipment.service_type = selected.serviceType || null;
    prepared.shipment.shipping_charge = formatMoney(selected.rate);
    await prepared.shipment.save();

    const placed = order.placed_at;
    const shipmentDate = `${String(placed.getDate()).padStart(2, "0")}-${String(placed.getMonth() + 1).padStart(2, "0")}-${placed.getFullYear()}`;
    const result = await IThinkClient.createReverseShipment({
      shipmentNumber: prepared.shipment.shipment_number,
      shipmentDate,
      totalAmount: formatMoney(Number(orderItem.unit_price) * prepared.quantity),
      pickupContact: {
        name: pickup.recipientName, address1: pickup.line1, address2: pickup.line2 ?? "", pincode: pickup.postalCode,
        city: pickup.city, state: pickup.state, country: pickup.country === "IN" ? "India" : pickup.country,
        phone: pickup.phone.replace(/\D/gu, "").slice(-10), email: order.contact_email ?? ""
      },
      products: [{ name: orderItem.variant_name ? `${orderItem.product_name} - ${orderItem.variant_name}` : orderItem.product_name, sku: orderItem.variant_sku ?? orderItem.product_sku, quantity: prepared.quantity, price: orderItem.unit_price }],
      lengthCm: prepared.shipment.length_cm, widthCm: prepared.shipment.width_cm, heightCm: prepared.shipment.height_cm,
      weightKg: (prepared.shipment.weight_grams / 1000).toFixed(3), logistics: selected.courier, serviceType: selected.serviceType
    });

    let lateBookingAwb: string | null = null;
    try {
      await sequelize.transaction(async (transaction) => {
        const returnRequest = await ReturnRequest.findByPk(returnRequestId, { transaction, lock: transaction.LOCK.UPDATE });
        const shipment = await ReturnShipment.findByPk(prepared.shipment.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!shipment || shipment.awb_number) return;
        shipment.provider_order_id = result.reference;
        shipment.awb_number = result.awb;
        shipment.carrier = result.courier ?? selected.courier;
        if (returnRequest?.status === "cancelled") {
          // A legacy row or a crash between the booking marker and this
          // guarded write may still complete after cancellation. Quarantine
          // the AWB locally first, then reconcile it with iThink below; it
          // must never become an active reverse shipment for a cancelled return.
          shipment.status = "failed";
          shipment.provider_status = result.awb ? "Booking completed after return cancellation" : "Accepted without AWB; reconciliation required";
          lateBookingAwb = result.awb;
        } else {
          shipment.status = result.awb ? "approved" : "failed";
          shipment.provider_status = result.awb ? "Accepted" : "Accepted without AWB; reconciliation required";
        }
        shipment.tracking_url = result.trackingUrl;
        shipment.last_synced_at = new Date();
        await shipment.save({ transaction });
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        await markFailure(prepared.shipment.id, "The provider returned an AWB already linked to another return shipment.", "RETURN_SHIPMENT_AWB_CONFLICT");
        throw new ReturnShipmentProviderError("RETURN_SHIPMENT_AWB_CONFLICT", "The provider returned an AWB already linked to another return shipment.", 409);
      }
      throw error;
    }

    if (lateBookingAwb) {
      try {
        await IThinkClient.cancel(lateBookingAwb);
        await sequelize.transaction(async (transaction) => {
          const shipment = await ReturnShipment.findByPk(prepared.shipment.id, { transaction, lock: transaction.LOCK.UPDATE });
          if (!shipment) return;
          shipment.status = "cancelled";
          shipment.cancelled_at ??= new Date();
          shipment.provider_status = "Cancelled";
          await shipment.save({ transaction });
        });
      } catch (error) {
        // The row remains failed/quarantined with the AWB and provider error;
        // local state never claims cancellation without provider confirmation.
        if (error instanceof IThinkClientError) throw error;
        throw error;
      }
    }

    await CommerceNotifications.returnPickupCreated(prepared.shipment.id);
    return ReturnShipmentService.getById(prepared.shipment.id);
  } catch (error) {
    if (error instanceof ReturnShipmentServiceabilityError || error instanceof ReturnShipmentProviderError || error instanceof ReturnShipmentCourierSelectionInvalidError) throw error;
    if (error instanceof IThinkClientError) {
      // Unlike forward Shipment, there is no "provider_status_unknown"
      // value in the requested reverse vocabulary — a network-uncertain
      // outcome (iThink may or may not have actually booked it) is marked
      // "failed" too, with the ambiguity spelled out in the stored message,
      // rather than inventing a 9th status value outside the brief's fixed
      // set. This is deliberately conservative: it never auto-retries, but
      // an admin must manually confirm with iThink before retrying — see
      // the Phase F.1 report's Limitations section.
      const message = error.uncertain
        ? "iThink may have accepted this reverse pickup, but no response was received. Reconcile with iThink before retrying."
        : error.message;
      await markFailure(prepared.shipment.id, message, error.code);
      throw new ReturnShipmentProviderError(`ITHINK_${error.code}`, message, error.uncertain ? 409 : 502);
    }
    throw error;
  }
}

async function ingest(returnShipmentId: number, courier: string | null, currentStatus: string | null, currentStatusCode: string | null, events: IThinkTrackingEvent[]): Promise<void> {
  let advancedTo: ReturnShipmentStatus | null = null;

  await sequelize.transaction(async (transaction) => {
    const shipment = await ReturnShipment.findByPk(returnShipmentId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!shipment) throw new ReturnShipmentNotFoundError(returnShipmentId);

    // Mirrors ShipmentModels/shipment.service.ts's identical guard: iThink
    // returning no tracking data at all for this AWB yet (a freshly-created
    // reverse pickup the courier hasn't scanned) is not a provider failure —
    // IThinkClient.track() signals it via currentStatus: null. Nothing to
    // ingest in that case: only last_synced_at moves, so a "no scans yet"
    // refresh never fabricates a tracking event or status change.
    if (currentStatus === null) {
      shipment.last_synced_at = new Date();
      await shipment.save({ transaction });
      return;
    }

    const fallbackAt = events.at(-1)?.eventAt ?? shipment.last_synced_at?.toISOString() ?? shipment.created_at.toISOString();
    const allEvents = events.some((event) => event.status === currentStatus) ? events : [...events, { status: currentStatus, statusCode: currentStatusCode, location: null, message: null, eventAt: fallbackAt }];
    for (const event of allEvents.sort((a, b) => providerDate(a.eventAt).getTime() - providerDate(b.eventAt).getTime())) {
      const eventAt = providerDate(event.eventAt);
      if (eventAt.getTime() === 0) continue;
      const normalized = normalizeIThinkReverseStatus(event.status);
      const dedupeKey = crypto.createHash("sha256").update([event.status, event.statusCode ?? "", event.location ?? "", event.message ?? "", event.eventAt].join("|")).digest("hex");
      const exists = await ReturnShipmentTrackingEvent.findOne({ where: { return_shipment_id: shipment.id, dedupe_key: dedupeKey }, transaction });
      if (!exists) {
        const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.returnShipmentTrackingEvents, transaction);
        await ReturnShipmentTrackingEvent.create({ id, return_shipment_id: shipment.id, dedupe_key: dedupeKey, provider_status: event.status,
          provider_status_code: event.statusCode, normalized_status: normalized, location: event.location, message: event.message, event_at: eventAt }, { transaction });
      }
    }
    const next = normalizeIThinkReverseStatus(currentStatus);
    shipment.provider_status = currentStatus;
    shipment.provider_status_code = currentStatusCode;
    shipment.carrier = courier ?? shipment.carrier;
    shipment.last_synced_at = new Date();
    if (canAdvanceReturnShipmentStatus(shipment.status, next)) {
      shipment.status = next;
      if (["picked_up", "in_transit"].includes(next) && !shipment.picked_up_at) shipment.picked_up_at = new Date();
      if (next === "delivered" && !shipment.delivered_at) shipment.delivered_at = new Date();
      if (next === "cancelled" && !shipment.cancelled_at) shipment.cancelled_at = new Date();
      // Deliberately does NOT touch ReturnRequest.item_received_at or
      // trigger any refund logic — per Phase F.1's explicit "Return
      // Delivered -> Admin Inspection -> Approve Refund" requirement, a
      // reverse shipment reaching "delivered" is purely informational.
      // Admin still separately confirms the physical item via the existing,
      // unchanged ReturnService.markItemReceived.
      advancedTo = next;
    }
    await shipment.save({ transaction });
  });

  if (advancedTo === "picked_up") await CommerceNotifications.returnPickedUp(returnShipmentId);
  if (advancedTo === "delivered") await CommerceNotifications.returnDelivered(returnShipmentId);
}

export const ReturnShipmentService = {
  toJSON,
  createForApprovedReturn,
  quoteForReturn,

  async getById(id: number): Promise<ReturnShipmentJSON> {
    const shipment = await ReturnShipment.findByPk(id, { include: [{ model: ReturnShipmentTrackingEvent, as: "trackingEvents" }], order: [[{ model: ReturnShipmentTrackingEvent, as: "trackingEvents" }, "event_at", "ASC"]] });
    if (!shipment) throw new ReturnShipmentNotFoundError(id);
    return toJSON(shipment);
  },

  async getForReturnRequest(returnRequestId: number): Promise<ReturnShipmentJSON | null> {
    const shipment = await ReturnShipment.findOne({ where: { return_request_id: returnRequestId }, include: [{ model: ReturnShipmentTrackingEvent, as: "trackingEvents" }] });
    return shipment ? toJSON(shipment) : null;
  },

  async refresh(id: number): Promise<ReturnShipmentJSON> {
    const shipment = await ReturnShipment.findByPk(id);
    if (!shipment) throw new ReturnShipmentNotFoundError(id);
    if (!shipment.awb_number) throw new ReturnShipmentActionNotAllowedError("Refresh tracking", shipment.status);
    try { const result = await IThinkClient.track(shipment.awb_number); await ingest(shipment.id, result.courier, result.currentStatus, result.currentStatusCode, result.events); }
    catch (error) { if (error instanceof IThinkClientError) throw new ReturnShipmentProviderError(`ITHINK_${error.code}`, error.message); throw error; }
    return this.getById(id);
  },

  /** Exposed for the background sync job (return-shipment-sync.job.ts) — same shape as ShipmentService's own ingest()-adjacent export pattern. */
  ingest
};
