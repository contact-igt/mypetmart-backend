import crypto from "node:crypto";

import { Op, UniqueConstraintError, type Transaction } from "sequelize";

import { shippingConfig } from "../../config/shipping.config.js";
import type { ShipmentSourceType, ShipmentStatus } from "../../constants/database.constants.js";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Order, OrderItem, Product, ProductVariant, Replacement, ReturnRequest, Shipment, ShipmentTrackingEvent, User } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { formatMoney } from "../../utils/product-money.js";
import { IThinkClient, IThinkClientError, type IThinkPackageInput, type IThinkTrackingEvent } from "./ithink.client.js";
import { ShipmentActionNotAllowedError, ShipmentNotEligibleError, ShipmentNotFoundError, ShipmentPackageDataError, ShipmentProviderError, ShipmentProviderNotConfiguredError, ShipmentServiceabilityError } from "./shipment.errors.js";
import type { AdminShipmentListResult, ReattemptInput, RtoInput, ShipmentJSON } from "./shipment.types.js";

const TERMINAL = new Set<ShipmentStatus>(["delivered", "rto_delivered", "cancelled"]);
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
    providerCost: shipment.shipping_charge,
    currency: shipment.currency,
    package: { weightGrams: shipment.weight_grams, lengthCm: shipment.length_cm, widthCm: shipment.width_cm, heightCm: shipment.height_cm },
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
type Prepared = { shipment: Shipment; created: boolean; order: Order; lines: PackageLine[]; totalAmount: string };

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

async function prepare(sourceType: ShipmentSourceType, sourceId: number): Promise<Prepared> {
  assertConfigured();
  return sequelize.transaction(async (transaction) => {
    let order: Order;
    let replacement: Replacement | null = null;
    if (sourceType === "order") {
      const row = await Order.findByPk(sourceId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw new ShipmentNotEligibleError(`Order '${sourceId}' was not found.`);
      order = row;
    } else {
      replacement = await Replacement.findByPk(sourceId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!replacement) throw new ShipmentNotEligibleError(`Replacement '${sourceId}' was not found.`);
      const row = await Order.findByPk(replacement.order_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!row) throw new ShipmentNotEligibleError("The replacement's original Order was not found.");
      order = row;
    }

    const existing = await Shipment.findOne({ where: { source_type: sourceType, source_id: sourceId }, transaction, lock: transaction.LOCK.UPDATE });
    if (existing && existing.status !== "failed") return { shipment: existing, created: false, order, lines: [], totalAmount: order.total };

    if (sourceType === "order") {
      if (order.payment_status !== "paid" || order.status !== "confirmed" || order.commerce_exception !== null || order.fulfilment_status === "delivered" || order.cancelled_at) {
        throw new ShipmentNotEligibleError("Only paid, confirmed Orders without a commerce exception or terminal fulfilment state may be shipped.");
      }
    } else if (!replacement || replacement.status !== "processing" || !replacement.stock_consumed_at) {
      throw new ShipmentNotEligibleError("Only processing Replacements with consumed inventory may be shipped.");
    }

    const orderItems = sourceType === "order"
      ? await OrderItem.findAll({ where: { order_id: order.id }, transaction, order: [["id", "ASC"]] })
      : await OrderItem.findAll({ where: { id: replacement!.order_item_id, order_id: order.id }, transaction });
    if (orderItems.length === 0) throw new ShipmentPackageDataError("No fulfilment items were found.");
    const lines = await Promise.all(orderItems.map((item) => packageLine(item, sourceType === "order" ? item.quantity : replacement!.quantity, transaction)));
    const parcel = aggregate(lines);
    const totalAmount = sourceType === "order" ? order.total : formatMoney(Number(orderItems[0]!.unit_price) * replacement!.quantity);

    if (existing) {
      existing.status = "pending";
      existing.provider_status = null;
      existing.provider_status_code = null;
      existing.last_synced_at = null;
      await existing.save({ transaction });
      return { shipment: existing, created: true, order, lines, totalAmount };
    }

    const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.shipments, transaction);
    const shipment = await Shipment.create({
      id, shipment_number: buildBusinessReference("shipment", id), source_type: sourceType, source_id: sourceId, order_id: order.id,
      replacement_id: replacement?.id ?? null, method: "standard", provider: "ithink", provider_order_id: null, provider_shipment_id: null,
      carrier: null, tracking_number: null, service_type: null, status: "pending", provider_status: null, provider_status_code: null,
      pickup_warehouse_id: shippingConfig.pickupAddressId!, weight_grams: parcel.weightGrams, length_cm: parcel.lengthCm, width_cm: parcel.widthCm,
      height_cm: parcel.heightCm, shipping_charge: null, currency: order.currency, shipped_at: null, delivered_at: null, cancelled_at: null,
      rto_at: null, last_synced_at: null, raw_payload: null
    }, { transaction });
    if (sourceType === "order" && order.fulfilment_status === "unfulfilled") { order.fulfilment_status = "processing"; await order.save({ transaction }); }
    return { shipment, created: true, order, lines, totalAmount };
  });
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
    weightKg: (shipment.weight_grams / 1000).toFixed(3), logistics: courier, serviceType
  };
}

async function markProviderFailure(id: number, status: ShipmentStatus, providerStatus: string): Promise<void> {
  await Shipment.update({ status, provider_status: providerStatus, last_synced_at: new Date() }, { where: { id } });
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

async function create(sourceType: ShipmentSourceType, sourceId: number): Promise<ShipmentJSON> {
  const prepared = await prepare(sourceType, sourceId);
  if (!prepared.created) return ShipmentService.getById(prepared.shipment.id);
  try {
    const serviceable = await IThinkClient.checkServiceability(prepared.order.ship_postal_code);
    if (serviceable.length === 0) { await markProviderFailure(prepared.shipment.id, "failed", "Unserviceable"); throw new ShipmentServiceabilityError(); }
    const rates = await IThinkClient.getRates({ toPincode: prepared.order.ship_postal_code, lengthCm: prepared.shipment.length_cm, widthCm: prepared.shipment.width_cm,
      heightCm: prepared.shipment.height_cm, weightKg: (prepared.shipment.weight_grams / 1000).toFixed(3), productMrp: prepared.totalAmount });
    const candidates = rates.filter((rate) => serviceable.includes(rate.courier.toLowerCase())).sort((a, b) => Number(a.rate) - Number(b.rate));
    const selected = candidates[0];
    if (!selected) { await markProviderFailure(prepared.shipment.id, "failed", "Rate unavailable"); throw new ShipmentProviderError("SHIPMENT_RATE_UNAVAILABLE", "No prepaid forward rate is currently available for this package."); }
    prepared.shipment.shipping_charge = formatMoney(selected.rate);
    prepared.shipment.carrier = selected.courier;
    prepared.shipment.service_type = selected.serviceType || null;
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
    return ShipmentService.getById(prepared.shipment.id);
  } catch (error) {
    if (error instanceof ShipmentServiceabilityError || error instanceof ShipmentProviderError) throw error;
    if (error instanceof IThinkClientError) {
      await markProviderFailure(prepared.shipment.id, error.uncertain ? "provider_status_unknown" : "failed", error.code);
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
    if (next === "delivered") { order.fulfilment_status = "delivered"; if (order.status !== "return_requested") order.status = "delivered"; }
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

async function ingest(shipmentId: number, courier: string | null, currentStatus: string, currentStatusCode: string | null, events: IThinkTrackingEvent[]): Promise<void> {
  await sequelize.transaction(async (transaction) => {
    const shipment = await Shipment.findByPk(shipmentId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!shipment) throw new ShipmentNotFoundError(shipmentId);
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
    if (canAdvanceShipmentStatus(shipment.status, next)) { shipment.status = next; await applyFulfilment(shipment, next, transaction); }
    await shipment.save({ transaction });
  });
}

export const ShipmentService = {
  toJSON,
  createForOrder: (orderId: number) => create("order", orderId),
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
