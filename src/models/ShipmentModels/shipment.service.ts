import crypto from "node:crypto";

import { Op, UniqueConstraintError, type Transaction } from "sequelize";

import { shippingConfig } from "../../config/shipping.config.js";
import type { ShipmentSourceType, ShipmentStatus } from "../../constants/database.constants.js";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Order, OrderItem, Payment, Product, ProductVariant, Replacement, ReturnRequest, Shipment, ShipmentTrackingEvent, User } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { formatMoney } from "../../utils/product-money.js";
import { IThinkClient, IThinkClientError, type IThinkPackageInput, type IThinkTrackingEvent } from "./ithink.client.js";
import { PaymentService } from "../PaymentModels/payment.service.js";
import { ShipmentActionNotAllowedError, ShipmentCourierSelectionInvalidError, ShipmentNotEligibleError, ShipmentNotFoundError, ShipmentPackageDataError, ShipmentProviderError, ShipmentProviderNotConfiguredError, ShipmentServiceabilityError, ShipmentValidationError } from "./shipment.errors.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import type { AdminShipmentListResult, CreateShipmentSelectionInput, OrderShipmentSummaryJSON, ReattemptInput, RtoInput, ShipmentFailureReasonJSON, ShipmentJSON, ShipmentQuoteResultJSON } from "./shipment.types.js";

// Exported so shipment-sync.job.ts's eligibility query can exclude the same
// terminal states without duplicating this literal list — behavior here is
// otherwise unchanged (still used internally exactly as before).
export const TERMINAL = new Set<ShipmentStatus>(["delivered", "rto_delivered", "cancelled"]);
const FORWARD_RANK: Partial<Record<ShipmentStatus, number>> = { pending: 0, created: 1, awb_assigned: 2, pickup_pending: 3, picked_up: 4, in_transit: 5, out_for_delivery: 6, delivery_exception: 7, ndr: 7, delivered: 8 };

export function normalizeIThinkStatus(providerStatus: string): ShipmentStatus {
  switch (providerStatus.trim().toLowerCase()) {
    case "manifested": return "pickup_pending";
    case "picked up": return "picked_up";
    case "in transit":
    case "reached at destination": return "in_transit";
    case "out for delivery": return "out_for_delivery";
    case "undelivered": return "ndr";
    case "not picked":
    case "out of delivery area":
    case "delayed":
    case "damaged":
    case "misrouted":
    case "lost":
    case "shortage": return "delivery_exception";
    case "delivered": return "delivered";
    case "cancelled": return "cancelled";
    case "rto pending":
    case "rto processing": return "rto_initiated";
    case "rto in transit":
    case "reached at origin":
    case "rto out for delivery":
    case "rto undelivered":
    case "rto shortage": return "rto_in_transit";
    case "rto delivered": return "rto_delivered";
    default: return "provider_status_unknown";
  }
}

export function canAdvanceShipmentStatus(current: ShipmentStatus, next: ShipmentStatus): boolean {
  if (current === next) return false;
  if (TERMINAL.has(current) || next === "provider_status_unknown") return false;
  if (next === "rto_initiated" || next === "rto_in_transit" || next === "rto_delivered") return true;
  if (current.startsWith("rto_")) return false;
  if ((current === "ndr" || current === "delivery_exception") && next === "out_for_delivery") return true;
  return (FORWARD_RANK[next] ?? -1) >= (FORWARD_RANK[current] ?? -1);
}

function providerDate(value: string): Date {
  const parsed = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(value) ? `${value.replace(" ", "T")}+05:30` : value);
  return Number.isNaN(parsed.getTime()) ? new Date(0) : parsed;
}

// raw_payload is a free-form JSON column reused for two distinct shapes
// depending on outcome — success ({ trackingUrl }) vs failure (this shape,
// written by markProviderFailure). Narrowed defensively since it's `unknown`
// at the DB layer and could in principle hold either shape or neither.
function readFailureReason(shipment: Shipment): ShipmentFailureReasonJSON {
  let payload = shipment.raw_payload;
  // The mysql2 driver does not always auto-parse a JSON column back into an
  // object (observed after a static Shipment.update() write, as opposed to
  // an instance .save()) — defensively parse a string before shape-checking.
  if (typeof payload === "string") {
    try { payload = JSON.parse(payload); } catch { return null; }
  }
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.errorCode !== "string" || typeof record.message !== "string" || typeof record.failedAt !== "string") return null;
  return { provider: typeof record.provider === "string" ? record.provider : "ithink", errorCode: record.errorCode, message: record.message, failedAt: record.failedAt };
}

function toJSON(shipment: Shipment): ShipmentJSON {
  return {
    id: shipment.id,
    shipmentNumber: shipment.shipment_number,
    sourceType: shipment.source_type,
    sourceId: shipment.source_id,
    orderId: shipment.order_id,
    replacementId: shipment.replacement_id,
    provider: shipment.provider,
    providerOrderId: shipment.provider_order_id,
    carrier: shipment.carrier,
    awbNumber: shipment.tracking_number,
    serviceType: shipment.service_type,
    status: shipment.status,
    providerStatus: shipment.provider_status,
    providerStatusCode: shipment.provider_status_code,
    failureReason: shipment.status === "failed" ? readFailureReason(shipment) : null,
    providerCost: shipment.shipping_charge,
    currency: shipment.currency,
    package: { weightGrams: shipment.weight_grams, lengthCm: shipment.length_cm, widthCm: shipment.width_cm, heightCm: shipment.height_cm },
    deliveryTat: shipment.delivery_tat ?? null,
    estimatedDelivery: shipment.estimated_delivery_min_date && shipment.estimated_delivery_max_date ? { min: shipment.estimated_delivery_min_date, max: shipment.estimated_delivery_max_date } : null,
    shippedAt: shipment.shipped_at?.toISOString() ?? null,
    deliveredAt: shipment.delivered_at?.toISOString() ?? null,
    cancelledAt: shipment.cancelled_at?.toISOString() ?? null,
    rtoAt: shipment.rto_at?.toISOString() ?? null,
    lastSyncedAt: shipment.last_synced_at?.toISOString() ?? null,
    createdAt: shipment.created_at.toISOString(),
    trackingEvents: (shipment.trackingEvents ?? []).map((event) => ({
      id: event.id, status: event.normalized_status, providerStatus: event.provider_status, providerStatusCode: event.provider_status_code,
      location: event.location, message: event.message, eventAt: event.event_at.toISOString()
    }))
  };
}

function assertConfigured(): void {
  if (shippingConfig.provider !== "ithink" || !shippingConfig.ready || !shippingConfig.pickupAddressId) throw new ShipmentProviderNotConfiguredError();
}

type PackageLine = { item: OrderItem; quantity: number; weight: number; length: number; width: number; height: number };
type Prepared = { shipment: Shipment; created: boolean; order: Order; lines: PackageLine[]; totalAmount: string; isCod: boolean };

async function packageLine(item: OrderItem, quantity: number, transaction: Transaction): Promise<PackageLine> {
  if (item.product_id === null) throw new ShipmentPackageDataError(`Order item '${item.id}' no longer has a product reference.`);
  const product = await Product.findByPk(item.product_id, { transaction, paranoid: false });
  if (!product) throw new ShipmentPackageDataError(`Shipping measurements are unavailable for order item '${item.id}'.`);
  const variant = item.product_variant_id === null ? null : await ProductVariant.findByPk(item.product_variant_id, { transaction, paranoid: false });
  const weight = variant?.weight_grams ?? product.weight_grams;
  const length = Number(variant?.length_cm ?? product.length_cm);
  const width = Number(variant?.width_cm ?? product.width_cm);
  const height = Number(variant?.height_cm ?? product.height_cm);
  if (!weight || !Number.isFinite(length) || !Number.isFinite(width) || !Number.isFinite(height) || length <= 0 || width <= 0 || height <= 0) {
    throw new ShipmentPackageDataError(`Order item '${item.id}' is missing positive shipping measurements.`);
  }
  return { item, quantity, weight, length, width, height };
}

// Pre-flight customer/address checks — everything here is already required
// NOT NULL at the Order schema level except phone/pincode *format*, which
// the schema can't enforce. Store/pickup/return-address configuration is
// deliberately NOT re-checked here — assertConfigured() already gates the
// entire prepare() call on that before any Order is even loaded, so
// repeating it here would just be dead code.
function collectOrderReadinessIssues(order: Order): string[] {
  const issues: string[] = [];
  if (!order.ship_recipient_name?.trim()) issues.push("Customer name");
  // Matches the existing >=10-after-stripping convention used elsewhere for
  // ship_phone (e.g. payment.service.ts's buildHostedCheckoutFields,
  // createInput's own .slice(-10)) — a country-code-prefixed number like
  // "+91 98765 43210" is valid, not just an exact 10-digit string.
  if (order.ship_phone.replace(/\D/gu, "").length < 10) issues.push("Customer phone number");
  if (!order.ship_line_1?.trim()) issues.push("Shipping address line 1");
  if (!order.ship_city?.trim()) issues.push("Shipping city");
  if (!order.ship_state?.trim()) issues.push("Shipping state");
  if (!/^[1-9][0-9]{5}$/u.test(order.ship_postal_code?.trim() ?? "")) issues.push("Shipping pincode");
  return issues;
}

// Collects every package-data problem across all lines instead of failing on
// the first (packageLine's own per-item throw is unchanged and still runs —
// this just doesn't let Promise.all short-circuit on the first rejection),
// so a multi-item Order missing dimensions on several products reports all
// of them together in one ShipmentValidationError.
async function collectPackageLines(orderItems: OrderItem[], quantityFor: (item: OrderItem) => number, transaction: Transaction): Promise<{ lines: PackageLine[]; issues: string[] }> {
  const lines: PackageLine[] = [];
  const issues: string[] = [];
  for (const item of orderItems) {
    try {
      lines.push(await packageLine(item, quantityFor(item), transaction));
    } catch (error) {
      issues.push(error instanceof Error ? error.message : `Order item '${item.id}' has invalid package data.`);
    }
  }
  return { lines, issues };
}

function aggregate(lines: PackageLine[]): { weightGrams: number; lengthCm: string; widthCm: string; heightCm: string } {
  const weightGrams = lines.reduce((sum, line) => sum + line.weight * line.quantity, 0);
  const length = Math.max(...lines.map((line) => line.length));
  const width = Math.max(...lines.map((line) => line.width));
  // V1 packaging rule: rectangular retail packs are stacked; the largest
  // footprint is retained and heights are summed per unit.
  const height = lines.reduce((sum, line) => sum + line.height * line.quantity, 0);
  if (weightGrams > 10_000 || length > 1000 || width > 1000 || height > 1000) throw new ShipmentPackageDataError("The aggregated package exceeds the iThink V3 domestic rate limits.");
  return { weightGrams, lengthCm: length.toFixed(2), widthCm: width.toFixed(2), heightCm: height.toFixed(2) };
}

async function resolveOrderOrReplacement(sourceType: ShipmentSourceType, sourceId: number, transaction: Transaction): Promise<{ order: Order; replacement: Replacement | null }> {
  if (sourceType === "order") {
    const row = await Order.findByPk(sourceId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!row) throw new ShipmentNotEligibleError(`Order '${sourceId}' was not found.`);
    return { order: row, replacement: null };
  }
  const replacement = await Replacement.findByPk(sourceId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!replacement) throw new ShipmentNotEligibleError(`Replacement '${sourceId}' was not found.`);
  const row = await Order.findByPk(replacement.order_id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!row) throw new ShipmentNotEligibleError("The replacement's original Order was not found.");
  return { order: row, replacement };
}

type Shippable = { isCod: boolean; lines: PackageLine[]; parcel: { weightGrams: number; lengthCm: string; widthCm: string; heightCm: string }; totalAmount: string };

/**
 * Eligibility + payment-mode + pre-flight validation — everything needed to
 * know WHETHER and HOW an Order/Replacement can be shipped, with no
 * Shipment row ever created or mutated. Shared by prepare() (which goes on
 * to create/reuse a Shipment row for an actual booking) and quote() (which
 * stops here and only asks iThink for rate candidates), so eligibility and
 * package validation can never drift between "what would this cost" and
 * "actually book it".
 */
async function validateShippable(sourceType: ShipmentSourceType, order: Order, replacement: Replacement | null, transaction: Transaction): Promise<Shippable> {
  // Computed once and reused for both eligibility (below) and the iThink
  // payment_mode/cod_amount payload fields (createInput) — a Payment row
  // with provider:"cod" on this Order is the same durable marker either
  // way, so there is no separate/second lookup for the payload fix.
  const codPayment = order.payment_status === "paid" ? null : await Payment.findOne({ where: { order_id: order.id, provider: "cod" }, transaction });
  const isCod = codPayment !== null;

  if (sourceType === "order") {
    // PayU eligibility is unchanged: order.payment_status === "paid" is
    // still the sole PayU signal, exactly as before. COD eligibility is a
    // separate, additive OR — a confirmed Order with a "cod" Payment
    // record (created by PaymentService.confirmCodOrder) is eligible even
    // though payment_status stays "pending" (COD funds are collected at
    // delivery, not captured upfront) — see docs on why payment_status is
    // never repurposed to mean "paid" for COD.
    const isPaidByProvider = order.payment_status === "paid" || isCod;
    if (!isPaidByProvider || order.status !== "confirmed" || order.commerce_exception !== null || order.fulfilment_status === "delivered" || order.cancelled_at) {
      throw new ShipmentNotEligibleError("Only paid Orders (PayU) or confirmed Cash on Delivery Orders, without a commerce exception or terminal fulfilment state, may be shipped.");
    }
  } else if (!replacement || replacement.status !== "processing" || !replacement.stock_consumed_at) {
    throw new ShipmentNotEligibleError("Only processing Replacements with consumed inventory may be shipped.");
  }

  const orderItems = sourceType === "order"
    ? await OrderItem.findAll({ where: { order_id: order.id }, transaction, order: [["id", "ASC"]] })
    : await OrderItem.findAll({ where: { id: replacement!.order_item_id, order_id: order.id }, transaction });
  if (orderItems.length === 0) throw new ShipmentPackageDataError("No fulfilment items were found.");

  // Pre-flight validation — everything here runs BEFORE any iThink API
  // call (checkServiceability/getRates/createShipment all happen later, in
  // create()/quote()). Customer/address issues and package-data issues are
  // collected together into one ShipmentValidationError rather than
  // failing on the first problem found.
  const readinessIssues = collectOrderReadinessIssues(order);
  const { lines, issues: packageIssues } = await collectPackageLines(orderItems, (item) => (sourceType === "order" ? item.quantity : replacement!.quantity), transaction);
  if (readinessIssues.length > 0 || packageIssues.length > 0) {
    throw new ShipmentValidationError([...readinessIssues, ...packageIssues]);
  }

  const parcel = aggregate(lines);
  const totalAmount = sourceType === "order" ? order.total : formatMoney(Number(orderItems[0]!.unit_price) * replacement!.quantity);

  return { isCod, lines, parcel, totalAmount };
}

async function prepare(sourceType: ShipmentSourceType, sourceId: number): Promise<Prepared> {
  assertConfigured();
  return sequelize.transaction(async (transaction) => {
    const { order, replacement } = await resolveOrderOrReplacement(sourceType, sourceId, transaction);

    const existing = await Shipment.findOne({ where: { source_type: sourceType, source_id: sourceId }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing && existing.status !== "failed") return { shipment: existing, created: false, order, lines: [], totalAmount: order.total, isCod: false };

    const { isCod, lines, parcel, totalAmount } = await validateShippable(sourceType, order, replacement, transaction);

    if (existing) {
      existing.status = "pending";
      existing.provider_status = null;
      existing.provider_status_code = null;
      existing.last_synced_at = null;
      await existing.save({ transaction });
      return { shipment: existing, created: true, order, lines, totalAmount, isCod };
    }

    const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.shipments, transaction);
    const shipment = await Shipment.create({
      id, shipment_number: buildBusinessReference("shipment", id), source_type: sourceType, source_id: sourceId, order_id: order.id,
      replacement_id: replacement?.id ?? null, method: "standard", provider: "ithink", provider_order_id: null, provider_shipment_id: null,
      carrier: null, tracking_number: null, service_type: null, status: "pending", provider_status: null, provider_status_code: null,
      pickup_warehouse_id: shippingConfig.pickupAddressId!, weight_grams: parcel.weightGrams, length_cm: parcel.lengthCm, width_cm: parcel.widthCm,
      height_cm: parcel.heightCm, shipping_charge: null, currency: order.currency, delivery_tat: null, estimated_delivery_min_date: null,
      estimated_delivery_max_date: null, shipped_at: null, delivered_at: null, cancelled_at: null,
      rto_at: null, last_synced_at: null, raw_payload: null
    }, { transaction });
    if (sourceType === "order" && order.fulfilment_status === "unfulfilled") { order.fulfilment_status = "processing"; await order.save({ transaction }); }
    return { shipment, created: true, order, lines, totalAmount, isCod };
  });
}

/**
 * Read-only rate quote — resolves eligibility/package data exactly like
 * prepare() (via the same validateShippable()) but never touches the
 * Shipment table at all. Returns every serviceable+priced candidate iThink
 * offers, not just the cheapest — the same `candidates` list create()
 * itself computes, just returned to the caller instead of collapsed down
 * to candidates[0]. No quote is ever persisted (see the Phase 1C report's
 * "Store Quote Temporarily" decision): the admin's later selection is
 * re-validated against a FRESH rate check at booking time in create(), so a
 * quote going stale between "shown" and "booked" fails safely rather than
 * silently booking a no-longer-valid rate.
 */
async function quote(sourceType: ShipmentSourceType, sourceId: number): Promise<ShipmentQuoteResultJSON> {
  assertConfigured();
  const { order, isCod, parcel, totalAmount } = await sequelize.transaction(async (transaction) => {
    const { order, replacement } = await resolveOrderOrReplacement(sourceType, sourceId, transaction);
    const shippable = await validateShippable(sourceType, order, replacement, transaction);
    return { order, ...shippable };
  });

  const paymentMode = isCod ? "cod" : "prepaid";
  // Bug fix: IThinkClient.checkServiceability/getRates can throw a raw
  // IThinkClientError (provider-side rejection, network failure, etc.) —
  // create() already converts that into a proper ApplicationError (see its
  // own outer catch below); quote() previously had no equivalent catch, so
  // that raw Error fell all the way to errorHandlerMiddleware's default
  // "not an ApplicationError" branch and surfaced as a generic 500
  // INTERNAL_ERROR instead of a real message. There is no Shipment row to
  // mark here (quote() never creates one — see this function's own doc
  // comment), so this only needs the error-shape conversion, not
  // markProviderFailure.
  try {
    const serviceable = await IThinkClient.checkServiceability(order.ship_postal_code, paymentMode);
    if (serviceable.length === 0) return { options: [] };

    const rates = await IThinkClient.getRates({
      toPincode: order.ship_postal_code, lengthCm: parcel.lengthCm, widthCm: parcel.widthCm, heightCm: parcel.heightCm,
      weightKg: (parcel.weightGrams / 1000).toFixed(3), productMrp: totalAmount, paymentMode
    });
    const options = rates
      .filter((rate) => serviceable.includes(rate.courier.toLowerCase()))
      .sort((a, b) => Number(a.rate) - Number(b.rate))
      .map((rate) => ({ carrier: rate.courier, serviceType: rate.serviceType, rate: rate.rate, deliveryTat: rate.deliveryTat ?? null, estimatedDelivery: rate.estimatedDelivery ?? null }));
    return { options };
  } catch (error) {
    if (error instanceof IThinkClientError) {
      throw new ShipmentProviderError("SERVICEABILITY_FAILED", error.message);
    }
    throw error;
  }
}

function createInput(prepared: Prepared, courier: string, serviceType: string): IThinkPackageInput {
  const { shipment, order, lines } = prepared;
  const placed = order.placed_at;
  const orderDate = `${String(placed.getDate()).padStart(2, "0")}-${String(placed.getMonth() + 1).padStart(2, "0")}-${placed.getFullYear()}`;
  return {
    orderNumber: shipment.shipment_number, orderDate, totalAmount: prepared.totalAmount,
    recipient: { name: order.ship_recipient_name, address1: order.ship_line_1, address2: order.ship_line_2 ?? "", pincode: order.ship_postal_code,
      city: order.ship_city, state: order.ship_state, country: order.ship_country === "IN" ? "India" : order.ship_country,
      phone: order.ship_phone.replace(/\D/gu, "").slice(-10), email: order.contact_email ?? "" },
    products: lines.map(({ item, quantity }) => ({ name: item.variant_name ? `${item.product_name} - ${item.variant_name}` : item.product_name, sku: item.variant_sku ?? item.product_sku, quantity, price: item.unit_price })),
    lengthCm: shipment.length_cm, widthCm: shipment.width_cm, heightCm: shipment.height_cm,
    weightKg: (shipment.weight_grams / 1000).toFixed(3), logistics: courier, serviceType,
    // Derived server-side from the Order's own Payment records (prepared.isCod,
    // computed once in prepare() — see its comment there); never trusted
    // from any client input, since nothing here is client-supplied at all.
    paymentMode: prepared.isCod ? "COD" : "Prepaid",
    codAmount: prepared.isCod ? prepared.totalAmount : "0"
  };
}

async function markProviderFailure(id: number, status: ShipmentStatus, providerStatus: string, failureDetail?: { errorCode: string; message: string }): Promise<void> {
  await Shipment.update(
    {
      status,
      provider_status: providerStatus,
      last_synced_at: new Date(),
      // Only ever overwrites raw_payload when a real failure detail is
      // supplied — callers that don't pass one (the refresh/reattempt/RTO
      // "uncertain outcome" paths, unrelated to shipment creation) keep
      // whatever raw_payload already held, exactly as before this change.
      ...(failureDetail ? { raw_payload: { provider: "ithink", errorCode: failureDetail.errorCode, message: failureDetail.message, failedAt: new Date().toISOString() } } : {})
    },
    { where: { id } }
  );
}

type ProviderMutationClaim = { claimed: boolean; shipment: Shipment; previousStatus: ShipmentStatus; previousProviderStatus: string | null };

async function claimProviderMutation(id: number, action: string, allowedStatuses: ShipmentStatus[]): Promise<ProviderMutationClaim> {
  return sequelize.transaction(async (transaction) => {
    const shipment = await Shipment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!shipment) throw new ShipmentNotFoundError(id);
    const pendingMarker = `${action} dispatch pending`;
    if (shipment.status === "provider_status_unknown" && shipment.provider_status === pendingMarker) {
      return { claimed: false, shipment, previousStatus: shipment.status, previousProviderStatus: shipment.provider_status };
    }
    if (shipment.provider_status === `${action} requested`) {
      return { claimed: false, shipment, previousStatus: shipment.status, previousProviderStatus: shipment.provider_status };
    }
    if (!shipment.tracking_number || !allowedStatuses.includes(shipment.status)) throw new ShipmentActionNotAllowedError(action, shipment.status);
    const previousStatus = shipment.status;
    const previousProviderStatus = shipment.provider_status;
    shipment.status = "provider_status_unknown";
    shipment.provider_status = pendingMarker;
    await shipment.save({ transaction });
    return { claimed: true, shipment, previousStatus, previousProviderStatus };
  });
}

async function restoreProviderMutation(id: number, claim: ProviderMutationClaim): Promise<void> {
  await Shipment.update({ status: claim.previousStatus, provider_status: claim.previousProviderStatus }, { where: { id, status: "provider_status_unknown" } });
}

async function create(sourceType: ShipmentSourceType, sourceId: number, selection?: CreateShipmentSelectionInput): Promise<ShipmentJSON> {
  const prepared = await prepare(sourceType, sourceId);
  if (!prepared.created) return ShipmentService.getById(prepared.shipment.id);
  // Serviceability check — runs before iThink's order/add is ever called
  // (see the try block below). "cod" vs "prepaid" is the same isCod this
  // Shipment was already prepared with (payment mode never changes between
  // prepare() and here within one create() call), and is the exact value
  // createInput() later sends as payment_mode/cod_amount — so the courier
  // candidates this check finds are guaranteed consistent with what the
  // actual booking request will ask for.
  const paymentMode = prepared.isCod ? "cod" : "prepaid";
  try {
    const serviceable = await IThinkClient.checkServiceability(prepared.order.ship_postal_code, paymentMode);
    if (serviceable.length === 0) {
      await markProviderFailure(prepared.shipment.id, "failed", "Serviceability Failed", {
        errorCode: "SERVICEABILITY_FAILED",
        message: `No ${paymentMode === "cod" ? "Cash on Delivery" : "prepaid"} courier service is available for destination pincode ${prepared.order.ship_postal_code}.`
      });
      throw new ShipmentServiceabilityError(paymentMode);
    }
    const rates = await IThinkClient.getRates({ toPincode: prepared.order.ship_postal_code, lengthCm: prepared.shipment.length_cm, widthCm: prepared.shipment.width_cm,
      heightCm: prepared.shipment.height_cm, weightKg: (prepared.shipment.weight_grams / 1000).toFixed(3), productMrp: prepared.totalAmount, paymentMode });
    const candidates = rates.filter((rate) => serviceable.includes(rate.courier.toLowerCase())).sort((a, b) => Number(a.rate) - Number(b.rate));

    // Manual selection (from a prior GET-quote step) is always re-verified
    // against THIS fresh candidate list — never trusted from the quote
    // moment, since rates/serviceability can change between quote and
    // booking (see quote()'s own doc comment). No match found (courier no
    // longer offered, or a bogus carrier/serviceType pair) is a distinct,
    // non-fallback failure — it must never silently fall back to the
    // automatic cheapest pick, which would book something the admin didn't
    // choose. Omitting selection entirely (undefined) is the existing,
    // unchanged automatic-cheapest-pick path every prior caller — including
    // retry() — still takes.
    let selected: (typeof candidates)[number] | undefined;
    if (selection) {
      selected = candidates.find((candidate) => candidate.courier.trim().toLowerCase() === selection.carrier.trim().toLowerCase() && candidate.serviceType === selection.serviceType);
      if (!selected) {
        await markProviderFailure(prepared.shipment.id, "failed", "Serviceability Failed", {
          errorCode: "COURIER_SELECTION_INVALID",
          message: "Selected courier is unavailable."
        });
        throw new ShipmentCourierSelectionInvalidError();
      }
    } else {
      selected = candidates[0];
    }
    if (!selected) {
      await markProviderFailure(prepared.shipment.id, "failed", "Serviceability Failed", {
        errorCode: "SERVICEABILITY_FAILED",
        message: `No ${paymentMode === "cod" ? "Cash on Delivery" : "prepaid"} rate is currently available for this package to pincode ${prepared.order.ship_postal_code}.`
      });
      throw new ShipmentProviderError("SHIPMENT_RATE_UNAVAILABLE", `No ${paymentMode === "cod" ? "Cash on Delivery" : "prepaid"} rate is currently available for this package.`);
    }
    prepared.shipment.shipping_charge = formatMoney(selected.rate);
    prepared.shipment.carrier = selected.courier;
    prepared.shipment.service_type = selected.serviceType || null;
    // Captured from the exact candidate actually booked — the same fresh
    // getRates() call this create() attempt already re-ran above (never the
    // caller's stale, earlier quote() result — see this function's own
    // comment on why selection is always re-verified against a fresh list).
    prepared.shipment.delivery_tat = selected.deliveryTat ?? null;
    prepared.shipment.estimated_delivery_min_date = selected.estimatedDelivery?.min ?? null;
    prepared.shipment.estimated_delivery_max_date = selected.estimatedDelivery?.max ?? null;
    await prepared.shipment.save();

    const result = await IThinkClient.createShipment(createInput(prepared, selected.courier, selected.serviceType));
    try {
      await sequelize.transaction(async (transaction) => {
        const shipment = await Shipment.findByPk(prepared.shipment.id, { transaction, lock: transaction.LOCK.UPDATE });
        if (!shipment || shipment.tracking_number) return;
        shipment.provider_order_id = result.reference;
        shipment.tracking_number = result.awb;
        shipment.carrier = result.courier ?? selected.courier;
        shipment.status = result.awb ? "awb_assigned" : "provider_status_unknown";
        shipment.provider_status = result.awb ? "Created" : "Accepted without AWB; reconciliation required";
        shipment.last_synced_at = new Date();
        shipment.raw_payload = result.trackingUrl ? { trackingUrl: result.trackingUrl } : null;
        await shipment.save({ transaction });
      });
    } catch (error) {
      if (error instanceof UniqueConstraintError) {
        await markProviderFailure(prepared.shipment.id, "provider_status_unknown", "AWB conflict requires reconciliation");
        throw new ShipmentProviderError("SHIPMENT_AWB_CONFLICT", "The provider returned an AWB already linked to another Shipment.", 409);
      }
      throw error;
    }
    // Post-commit notification dispatch — see payment-finalization.service.ts
    // for why this always happens after the transaction, never inside it.
    // shipmentCreated() re-verifies the Shipment actually has an AWB before
    // sending (the "accepted without AWB, reconciliation required" outcome
    // above must not trigger this email), and NotificationService's durable
    // dedupe (keyed by shipment.id) guarantees exactly one send even if
    // create() is invoked again for the same Shipment.
    await CommerceNotifications.shipmentCreated(prepared.shipment.id);
    return ShipmentService.getById(prepared.shipment.id);
  } catch (error) {
    if (error instanceof ShipmentServiceabilityError || error instanceof ShipmentProviderError) throw error;
    if (error instanceof IThinkClientError) {
      // error.message here is the real remark iThink returned (e.g. for
      // CREATE_REJECTED, IThinkClient.createShipment already extracts
      // result.remark) — previously only error.code ("CREATE_REJECTED")
      // reached provider_status and the detailed message was discarded once
      // this thrown error was caught by the controller. Now both are
      // persisted into raw_payload (see markProviderFailure), so it survives
      // a page reload instead of only being visible in the one-time toast.
      await markProviderFailure(prepared.shipment.id, error.uncertain ? "provider_status_unknown" : "failed", error.code, { errorCode: error.code, message: error.message });
      throw new ShipmentProviderError(error.uncertain ? "SHIPMENT_PROVIDER_STATUS_UNKNOWN" : `ITHINK_${error.code}`, error.uncertain ? "iThink may have accepted this Shipment, but no response was received. Reconcile it before retrying." : error.message, error.uncertain ? 409 : 502);
    }
    throw error;
  }
}

async function applyFulfilment(shipment: Shipment, next: ShipmentStatus, transaction: Transaction): Promise<void> {
  const now = new Date();
  if (["picked_up", "in_transit", "out_for_delivery"].includes(next) && !shipment.shipped_at) shipment.shipped_at = now;
  if (next === "delivered" && !shipment.delivered_at) shipment.delivered_at = now;
  if (next === "cancelled" && !shipment.cancelled_at) shipment.cancelled_at = now;
  if (next.startsWith("rto_") && !shipment.rto_at) shipment.rto_at = now;

  if (shipment.source_type === "order") {
    const order = await Order.findByPk(shipment.order_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!order) return;
    if (["picked_up", "in_transit", "out_for_delivery"].includes(next)) { order.fulfilment_status = "shipped"; if (["confirmed", "processing"].includes(order.status)) order.status = "shipped"; }
    if (next === "delivered") {
      order.fulfilment_status = "delivered";
      if (order.status !== "return_requested") order.status = "delivered";
      // COD funds are only actually collected at the door — courier-confirmed
      // delivery is that collection event. Mutates order.payment_status in
      // place (no-op for PayU Orders, already "paid") so the save() below
      // persists status/fulfilment_status/payment_status together.
      await PaymentService.markCodDelivered(order, shipment.delivered_at!, transaction);
    }
    await order.save({ transaction });
  } else if (next === "delivered" && shipment.replacement_id) {
    const replacement = await Replacement.findByPk(shipment.replacement_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (replacement?.status === "processing") {
      replacement.status = "completed"; replacement.completed_at = now; await replacement.save({ transaction });
      const returnRequest = await ReturnRequest.findByPk(replacement.return_request_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (returnRequest && returnRequest.status === "approved") { returnRequest.status = "resolved"; returnRequest.resolved_at = now; await returnRequest.save({ transaction }); }
    }
  }
}

async function ingest(shipmentId: number, courier: string | null, currentStatus: string | null, currentStatusCode: string | null, events: IThinkTrackingEvent[]): Promise<void> {
  let advancedTo: { sourceType: ShipmentSourceType; next: ShipmentStatus; orderId: number; replacementId: number | null } | null = null;

  await sequelize.transaction(async (transaction) => {
    const shipment = await Shipment.findByPk(shipmentId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!shipment) throw new ShipmentNotFoundError(shipmentId);

    // currentStatus === null is IThinkClient.track()'s explicit "no tracking
    // data at all for this AWB yet" signal (see its own comment) — not a
    // provider failure, but also nothing to ingest: there is no real scan to
    // record and no new status to compare against what this Shipment already
    // has. Only last_synced_at moves, so a "no scans yet" refresh can never
    // fabricate a tracking event or a status change on every poll.
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
      const normalized = normalizeIThinkStatus(event.status);
      const dedupeKey = crypto.createHash("sha256").update([event.status, event.statusCode ?? "", event.location ?? "", event.message ?? "", event.eventAt].join("|")).digest("hex");
      const exists = await ShipmentTrackingEvent.findOne({ where: { shipment_id: shipment.id, dedupe_key: dedupeKey }, transaction });
      if (!exists) {
        const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.shipmentTrackingEvents, transaction);
        await ShipmentTrackingEvent.create({ id, shipment_id: shipment.id, dedupe_key: dedupeKey, provider_status: event.status,
          provider_status_code: event.statusCode, normalized_status: normalized, location: event.location, message: event.message, event_at: eventAt }, { transaction });
      }
    }
    const next = normalizeIThinkStatus(currentStatus);
    shipment.provider_status = currentStatus;
    shipment.provider_status_code = currentStatusCode;
    shipment.carrier = courier ?? shipment.carrier;
    shipment.last_synced_at = new Date();
    if (canAdvanceShipmentStatus(shipment.status, next)) {
      shipment.status = next;
      await applyFulfilment(shipment, next, transaction);
      advancedTo = { sourceType: shipment.source_type, next, orderId: shipment.order_id, replacementId: shipment.replacement_id };
    }
    await shipment.save({ transaction });
  });

  // Post-commit notification dispatch — see payment-finalization.service.ts
  // for why this always happens after the transaction, never inside it.
  // Each CommerceNotifications call independently re-verifies the actual
  // persisted state before sending, so attempting a call whose target
  // milestone this particular sync step didn't reach (e.g. "shipped" is
  // attempted on every picked_up/in_transit/out_for_delivery advance, not
  // just the first one) is always safe — it just re-confirms and no-ops.
  if (advancedTo) {
    const { sourceType, next, orderId, replacementId } = advancedTo;
    if (sourceType === "order") {
      if (["picked_up", "in_transit", "out_for_delivery"].includes(next)) await CommerceNotifications.orderShipped(orderId);
      if (next === "out_for_delivery") await CommerceNotifications.orderOutForDelivery(shipmentId);
      if (next === "delivered") await CommerceNotifications.orderDelivered(orderId);
      if (next === "rto_initiated") await CommerceNotifications.orderReturnedToOrigin(shipmentId);
      if (next === "ndr" || next === "delivery_exception") await CommerceNotifications.deliveryAttemptFailed(shipmentId);
    } else if (sourceType === "replacement") {
      if (next === "picked_up") await CommerceNotifications.replacementShipped(shipmentId);
      if (next === "delivered" && replacementId) await CommerceNotifications.replacementCompleted(replacementId);
    }
  }
}

export const ShipmentService = {
  toJSON,
  createForOrder: (orderId: number, selection?: CreateShipmentSelectionInput) => create("order", orderId, selection),

  /**
   * Read-only rate quote for an Order — never creates or mutates a
   * Shipment. Returns every serviceable+priced courier candidate, not just
   * the cheapest (see quote()'s own doc comment for why nothing is
   * persisted between this call and a later createForOrder(selection)).
   */
  quoteForOrder: (orderId: number) => quote("order", orderId),

  /**
   * Retries a failed Shipment. Reuses the exact same create() orchestration
   * a fresh "Create shipment" click already runs — prepare()'s own
   * `existing.status === "failed"` branch resets the row to "pending" and
   * lets create() re-attempt serviceability/rate/order-add from scratch, so
   * this is a thin, explicit entry point onto that existing mechanism
   * (previously only reachable indirectly by re-clicking Create shipment),
   * not a second implementation of it.
   */
  async retry(id: number): Promise<ShipmentJSON> {
    const shipment = await Shipment.findByPk(id);
    if (!shipment) throw new ShipmentNotFoundError(id);
    if (shipment.status !== "failed") throw new ShipmentActionNotAllowedError("Retry", shipment.status);
    return create(shipment.source_type, shipment.source_id);
  },
  createForReplacement: (replacementId: number) => create("replacement", replacementId),

  async getById(id: number): Promise<ShipmentJSON> {
    const shipment = await Shipment.findByPk(id, { include: [{ model: ShipmentTrackingEvent, as: "trackingEvents" }], order: [[{ model: ShipmentTrackingEvent, as: "trackingEvents" }, "event_at", "ASC"]] });
    if (!shipment) throw new ShipmentNotFoundError(id);
    return toJSON(shipment);
  },

  async getForOrder(orderId: number): Promise<ShipmentJSON | null> {
    const shipment = await Shipment.findOne({ where: { source_type: "order", source_id: orderId }, include: [{ model: ShipmentTrackingEvent, as: "trackingEvents" }] });
    return shipment ? toJSON(shipment) : null;
  },

  /**
   * Batch equivalent of getForOrder() for order-listing pages — one query
   * for any number of orders (no per-order N+1), no trackingEvents include
   * since a listing preview only needs status/carrier/whether tracking
   * exists at all. Only the order's own shipment is considered (source_type
   * "order"); a Replacement's shipment also carries the parent order_id but
   * is a distinct shipment scoped to ReturnModels, not this Order's own.
   */
  async getSummariesForOrders(orderIds: number[]): Promise<Map<number, OrderShipmentSummaryJSON>> {
    if (orderIds.length === 0) return new Map();
    const shipments = await Shipment.findAll({
      where: { source_type: "order", order_id: { [Op.in]: orderIds } },
      attributes: ["order_id", "status", "carrier", "tracking_number"]
    });
    const map = new Map<number, OrderShipmentSummaryJSON>();
    for (const shipment of shipments) {
      map.set(shipment.order_id, {
        status: shipment.status,
        carrier: shipment.carrier,
        trackingAvailable: Boolean(shipment.tracking_number)
      });
    }
    return map;
  },

  async getForReplacement(replacementId: number): Promise<ShipmentJSON | null> {
    const shipment = await Shipment.findOne({ where: { source_type: "replacement", source_id: replacementId }, include: [{ model: ShipmentTrackingEvent, as: "trackingEvents" }] });
    return shipment ? toJSON(shipment) : null;
  },

  async list(query: { page?: number | undefined; pageSize?: number | undefined; status?: ShipmentStatus | undefined; sourceType?: ShipmentSourceType | undefined; courier?: string | undefined }): Promise<AdminShipmentListResult> {
    const page = query.page ?? 1; const pageSize = query.pageSize ?? 20;
    const where = { ...(query.status ? { status: query.status } : {}), ...(query.sourceType ? { source_type: query.sourceType } : {}), ...(query.courier ? { carrier: { [Op.like]: `%${query.courier}%` } } : {}) };
    const { rows, count } = await Shipment.findAndCountAll({ where, include: [{ model: Order, as: "order", include: [{ model: User, as: "user", required: false }] }, { model: Replacement, as: "replacement", required: false }], order: [["created_at", "DESC"]], limit: pageSize, offset: (page - 1) * pageSize, distinct: true });
    return { items: rows.map((shipment) => ({ ...toJSON(shipment), sourceReference: shipment.source_type === "order" ? shipment.order?.order_number ?? String(shipment.source_id) : shipment.replacement?.replacement_number ?? String(shipment.source_id), customerName: shipment.order?.user?.name ?? shipment.order?.ship_recipient_name ?? "Guest" })), total: count, page, pageSize, totalPages: Math.ceil(count / pageSize) };
  },

  async refresh(id: number): Promise<ShipmentJSON> {
    const shipment = await Shipment.findByPk(id);
    if (!shipment) throw new ShipmentNotFoundError(id);
    if (!shipment.tracking_number) throw new ShipmentActionNotAllowedError("Refresh tracking", shipment.status);
    try { const result = await IThinkClient.track(shipment.tracking_number); await ingest(shipment.id, result.courier, result.currentStatus, result.currentStatusCode, result.events); }
    catch (error) { if (error instanceof IThinkClientError) throw new ShipmentProviderError(`ITHINK_${error.code}`, error.message); throw error; }
    return this.getById(id);
  },

  async cancel(id: number): Promise<ShipmentJSON> {
    const claim = await claimProviderMutation(id, "Cancellation", ["awb_assigned", "pickup_pending"]);
    if (!claim.claimed) return this.getById(id);
    try { await IThinkClient.cancel(claim.shipment.tracking_number!); await sequelize.transaction(async (transaction) => { const locked = await Shipment.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE }); if (locked) { locked.status = "cancelled"; locked.provider_status = "Cancelled"; await applyFulfilment(locked, "cancelled", transaction); await locked.save({ transaction }); } }); }
    catch (error) { if (error instanceof IThinkClientError) { if (error.uncertain) await markProviderFailure(id, "provider_status_unknown", error.code); else await restoreProviderMutation(id, claim); throw new ShipmentProviderError(`ITHINK_${error.code}`, error.message); } throw error; }
    return this.getById(id);
  },

  async reattempt(id: number, input: ReattemptInput): Promise<ShipmentJSON> {
    const claim = await claimProviderMutation(id, "Reattempt", ["ndr", "delivery_exception"]);
    if (!claim.claimed) return this.getById(id);
    const order = await Order.findByPk(claim.shipment.order_id);
    if (!order) { await restoreProviderMutation(id, claim); throw new ShipmentNotEligibleError("The shipment's Order was not found."); }
    try { await IThinkClient.ndr({ awb: claim.shipment.tracking_number!, action: 1, date: input.date, time: input.time, phone: order.ship_phone.replace(/\D/gu, "").slice(-10), address: [order.ship_line_1, order.ship_line_2, order.ship_city, order.ship_state, order.ship_postal_code].filter(Boolean).join(", ") }); await Shipment.update({ status: claim.previousStatus, provider_status: "Reattempt requested" }, { where: { id, status: "provider_status_unknown" } }); }
    catch (error) { if (error instanceof IThinkClientError) { if (error.uncertain) await markProviderFailure(id, "provider_status_unknown", error.code); else await restoreProviderMutation(id, claim); throw new ShipmentProviderError(`ITHINK_${error.code}`, error.message); } throw error; }
    return this.getById(id);
  },

  async requestRto(id: number, input: RtoInput): Promise<ShipmentJSON> {
    const claim = await claimProviderMutation(id, "RTO", ["ndr", "delivery_exception"]);
    if (!claim.claimed) return this.getById(id);
    try { await IThinkClient.ndr({ awb: claim.shipment.tracking_number!, action: 2, reason: input.reason }); await Shipment.update({ status: "rto_initiated", provider_status: "RTO requested", rto_at: new Date() }, { where: { id, status: "provider_status_unknown" } }); }
    catch (error) { if (error instanceof IThinkClientError) { if (error.uncertain) await markProviderFailure(id, "provider_status_unknown", error.code); else await restoreProviderMutation(id, claim); throw new ShipmentProviderError(`ITHINK_${error.code}`, error.message); } throw error; }
    return this.getById(id);
  }
};
