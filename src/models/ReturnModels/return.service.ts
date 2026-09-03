import { Op, type Transaction } from "sequelize";

import { paymentConfig } from "../../config/payment.config.js";
import { sequelize } from "../../database/index.js";
import { Order } from "../../database/tables/OrderTable/index.js";
import { OrderItem } from "../../database/tables/OrderItemTable/index.js";
import { Payment } from "../../database/tables/PaymentTable/index.js";
import { Refund } from "../../database/tables/RefundTable/index.js";
import { Replacement } from "../../database/tables/ReplacementTable/index.js";
import { ReturnNote } from "../../database/tables/ReturnNoteTable/index.js";
import { ReturnRequest } from "../../database/tables/ReturnRequestTable/index.js";
import { ReturnShipment } from "../../database/tables/ReturnShipmentTable/index.js";
import { Shipment } from "../../database/tables/ShipmentTable/index.js";
import { ShipmentTrackingEvent } from "../../database/tables/ShipmentTrackingEventTable/index.js";
import { User } from "../../database/tables/UserTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { formatMoney } from "../../utils/product-money.js";
import { getValidNextOrderStatuses } from "../OrderModels/order.constants.js";
import { OrderNotFoundError } from "../OrderModels/order.errors.js";
import { ReplacementService } from "../ReplacementModels/replacement.service.js";
import { classifyIThinkReverseCancellationStage, isStaleReturnBookingMarker, RETURN_SHIPMENT_BOOKING_IN_PROGRESS, STALE_RETURN_BOOKING_MARKER_MS, ReturnShipmentService } from "../ReturnShipmentModels/return-shipment.service.js";
import { resolvePickupAddress } from "./return-pickup-address.js";
import { IThinkClient, IThinkClientError } from "../ShipmentModels/ithink.client.js";
import { ShipmentService } from "../ShipmentModels/shipment.service.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import {
  ReturnAlreadyReviewedError,
  ReturnCancellationNotAllowedError,
  ReturnCancellationProviderError,
  ReturnItemAlreadyReceivedError,
  ReturnItemNotReceivedError,
  ReturnItemReceiptNotApplicableError,
  ReturnNotEligibleError,
  ReturnOrderItemNotFoundError,
  ReturnPickupAddressNotEditableError,
  ReturnQuantityExceedsAvailableError,
  ReturnRequestNotFoundError
} from "./return.errors.js";
import type {
  AdminReviewReturnInput,
  CreateReturnRequestInput,
  ListReturnsParams,
  ListReturnsResultJSON,
  ReturnCaller,
  ReturnRequestDetailJSON,
  ReturnRequestJSON,
  UpdateReturnPickupAddressInput
} from "./return.types.js";
import type { ReturnShipmentJSON } from "../ReturnShipmentModels/return-shipment.types.js";

// Return process states that still "hold" their quantity against the
// OrderItem — a rejected request releases its quantity back to the pool
// (never happened), but requested/approved/resolved all keep it reserved
// (resolved means the return already completed, not that it should free up
// room for a second one).
const QUANTITY_HOLDING_STATUSES = ["requested", "approved", "resolved"] as const;

function toJSON(returnRequest: ReturnRequest, order: Order, orderItem: OrderItem, refunds: Refund[], replacement: Replacement | null, shipment: Shipment | null = null, returnShipment: ReturnShipmentJSON | null = null): ReturnRequestJSON {
  return {
    id: returnRequest.id,
    returnNumber: returnRequest.return_number,
    orderId: order.id,
    orderNumber: order.order_number,
    orderItemId: orderItem.id,
    productName: orderItem.product_name,
    variantName: orderItem.variant_name,
    purchasedQuantity: orderItem.quantity,
    quantity: returnRequest.quantity,
    resolution: returnRequest.type === "replacement" ? "replacement" : "refund",
    status: returnRequest.status,
    reason: returnRequest.reason,
    resolutionNote: returnRequest.resolution_note,
    requestedAt: returnRequest.requested_at.toISOString(),
    resolvedAt: returnRequest.resolved_at ? returnRequest.resolved_at.toISOString() : null,
    cancelledAt: returnRequest.cancelled_at ? returnRequest.cancelled_at.toISOString() : null,
    cancellationReason: returnRequest.cancellation_reason,
    cancellationSource: returnRequest.cancellation_source,
    itemReceivedAt: returnRequest.item_received_at ? returnRequest.item_received_at.toISOString() : null,
    refunds: refunds.map((refund) => ({
      id: refund.id,
      refundNumber: refund.refund_number,
      status: refund.status,
      amount: refund.amount,
      currency: refund.currency,
      initiatedAt: refund.initiated_at.toISOString(),
      completedAt: refund.completed_at ? refund.completed_at.toISOString() : null,
      failedAt: refund.failed_at ? refund.failed_at.toISOString() : null,
      failureMessage: refund.failure_message
    })),
    replacement: replacement ? ReplacementService.toJSON(replacement, shipment ? ShipmentService.toJSON(shipment) : null) : null,
    returnShipment
  };
}

type ReturnCancellationActor = { id: number; source: "customer" | "admin" };

const RETURN_CANCELLABLE_STATUSES = new Set(["requested", "approved"]);
const ACTIVE_REFUND_STATUS_VALUES = ["pending", "processing", "succeeded"] as const;
const ACTIVE_REFUND_STATUSES: ReadonlySet<string> = new Set(ACTIVE_REFUND_STATUS_VALUES);

type ReturnCancellationEligibilityInput = {
  status: ReturnRequest["status"];
  refunds: Array<{ status: Refund["status"] }>;
  replacement: Replacement | null;
  returnShipment: (Pick<ReturnShipmentJSON, "status" | "providerStatus" | "awbNumber"> & { updatedAt: Date | string }) | null;
};

type ReturnCancellationIntent = {
  kind: "return-cancellation";
  requestedAt: string;
  previousProviderStatus: string | null;
};

function readCancellationIntent(rawPayload: unknown): ReturnCancellationIntent | null {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) return null;
  const intent = (rawPayload as Record<string, unknown>).cancellationIntent;
  if (!intent || typeof intent !== "object" || Array.isArray(intent)) return null;
  const value = intent as Record<string, unknown>;
  return value.kind === "return-cancellation" && typeof value.requestedAt === "string"
    ? { kind: "return-cancellation", requestedAt: value.requestedAt, previousProviderStatus: typeof value.previousProviderStatus === "string" ? value.previousProviderStatus : null }
    : null;
}

// Merge extra keys into a ReturnShipment.raw_payload WITHOUT discarding what
// is already there — a prior booking payload, an earlier failureReason
// ({ provider, errorCode, message, failedAt } — see markFailure /
// readFailureReason), provider diagnostics. raw_payload is a JSON column, so
// normally an object or null; a string is tolerated (parsed if it is JSON,
// otherwise kept verbatim under `previousRawPayload`, matching
// readFailureReason's own defensive string handling) and an array is kept the
// same way rather than dropped.
function mergeRawPayload(existing: unknown, additions: Record<string, unknown>): Record<string, unknown> {
  let base: Record<string, unknown> = {};
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    base = { ...(existing as Record<string, unknown>) };
  } else if (typeof existing === "string") {
    try {
      const parsed: unknown = JSON.parse(existing);
      base = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? { ...(parsed as Record<string, unknown>) } : { previousRawPayload: existing };
    } catch {
      base = { previousRawPayload: existing };
    }
  } else if (Array.isArray(existing)) {
    base = { previousRawPayload: existing };
  }
  return { ...base, ...additions };
}

function cancellationIntentPayload(returnShipment: ReturnShipment): Record<string, unknown> {
  const merged = mergeRawPayload(returnShipment.raw_payload, {
    cancellationIntent: {
      kind: "return-cancellation",
      requestedAt: new Date().toISOString(),
      previousProviderStatus: returnShipment.provider_status
    }
  });
  // Only supply a provider tag when the existing payload had none — never
  // overwrite one a real booking/failure payload already carries.
  if (typeof merged.provider !== "string") merged.provider = "ithink";
  return merged;
}

function getReturnCancellationBlockReason(input: ReturnCancellationEligibilityInput): string | null {
  if (!RETURN_CANCELLABLE_STATUSES.has(input.status)) {
    return `the current return status is '${input.status}'.`;
  }
  if (input.refunds.some((refund) => ACTIVE_REFUND_STATUSES.has(refund.status))) {
    return "a refund is already pending, processing, or completed.";
  }
  if (input.replacement) {
    return "replacement processing has already started.";
  }
  if (!input.returnShipment || input.returnShipment.status === "cancelled") return null;
  if (input.returnShipment.providerStatus === RETURN_SHIPMENT_BOOKING_IN_PROGRESS) {
    // A fresh marker means an AWB could still be assigned at any moment —
    // block. A stale marker is an abandoned attempt (no AWB was ever
    // persisted); the cancellation itself recovers that row to "failed" and
    // proceeds locally, with no provider call. See cancelReturnRequest.
    return isStaleReturnBookingMarker(input.returnShipment) ? null : "reverse shipment creation is still in progress.";
  }

  const stage = classifyIThinkReverseCancellationStage(input.returnShipment.providerStatus, input.returnShipment.status);
  if (stage === "cancelled" || !input.returnShipment.awbNumber || stage === "pre_pickup") return null;
  return "the reverse shipment has already progressed beyond the cancellable pickup stage.";
}

// Re-issue a reverse cancellation for a shipment that already carries a
// cancellationIntent — i.e. a prior attempt reached the provider but local
// persistence failed, and tracking has not yet caught up to show the cancel.
// The earlier cancel may already have landed, so a hard rejection here is
// disambiguated with ONE tracking read (never another cancel): if the
// provider now reports cancelled, treat it as done; otherwise surface
// uncertainty and leave local state untouched. At most one cancel + one track
// per call — no retry loop.
async function reissuePendingReverseCancellation(awb: string, localStatus: ReturnShipment["status"]): Promise<void> {
  try {
    await IThinkClient.cancel(awb);
    return;
  } catch (error) {
    if (!(error instanceof IThinkClientError)) throw error;
    if (error.uncertain) throw error;
    let tracked;
    try {
      tracked = await IThinkClient.track(awb);
    } catch {
      throw new IThinkClientError("CANCELLATION_RECONCILIATION_UNCERTAIN", "iThink cancellation could not be confirmed.", true);
    }
    if (classifyIThinkReverseCancellationStage(tracked.currentStatus, localStatus) === "cancelled") return;
    throw new IThinkClientError("CANCELLATION_RECONCILIATION_UNCERTAIN", "iThink did not confirm the reverse cancellation.", true);
  }
}

async function cancelReturnRequest(actor: ReturnCancellationActor, returnId: number, reason: string | undefined, customerId?: number): Promise<void> {
  try {
    const operation = await sequelize.transaction(async (transaction) => {
      const returnRequest = await ReturnRequest.findOne({
        where: customerId === undefined ? { id: returnId } : { id: returnId, user_id: customerId },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!returnRequest) throw new ReturnRequestNotFoundError(returnId);

      // Idempotency is intentionally checked before looking at the shipment:
      // a completed return cancellation must never call iThink a second time.
      if (returnRequest.status === "cancelled") return null;
      const activeRefund = await Refund.findOne({
        where: { return_request_id: returnRequest.id, status: { [Op.in]: ACTIVE_REFUND_STATUS_VALUES } },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      // A replacement row means stock allocation has already begun. Do not
      // cancel a return while that irreversible replacement flow is active.
      const replacement = await Replacement.findOne({ where: { return_request_id: returnRequest.id }, transaction, lock: transaction.LOCK.UPDATE });

      const returnShipment = await ReturnShipment.findOne({ where: { return_request_id: returnRequest.id }, transaction, lock: transaction.LOCK.UPDATE });
      const blockReason = getReturnCancellationBlockReason({
        status: returnRequest.status,
        refunds: activeRefund ? [activeRefund] : [],
        replacement,
        returnShipment: returnShipment
          ? { status: returnShipment.status, providerStatus: returnShipment.provider_status, awbNumber: returnShipment.awb_number, updatedAt: returnShipment.updated_at }
          : null
      });
      if (blockReason) throw new ReturnCancellationNotAllowedError(blockReason);

      const now = new Date();
      if (returnShipment && isStaleReturnBookingMarker({ status: returnShipment.status, providerStatus: returnShipment.provider_status, awbNumber: returnShipment.awb_number, updatedAt: returnShipment.updated_at })) {
        // Stranded "Booking in progress" marker: the booking process died
        // before persisting an AWB or failing cleanly. Recover the row to
        // "failed" with a diagnostic payload (merged, never clobbered) so it
        // stops blocking, then cancel the return locally. NO provider call —
        // no AWB was ever recorded and fabricating one is never acceptable.
        // If an uncertain create left an orphan reverse shipment provider-side,
        // the sync job / manual reconciliation owns it; this payload records
        // the marker that was recovered for that follow-up.
        returnShipment.status = "failed";
        returnShipment.provider_status = "BOOKING_MARKER_STALE";
        returnShipment.last_synced_at = now;
        returnShipment.raw_payload = mergeRawPayload(returnShipment.raw_payload, {
          provider: "ithink",
          errorCode: "BOOKING_MARKER_STALE",
          message: `Reverse booking marker was abandoned (no AWB assigned, unchanged for over ${Math.round(STALE_RETURN_BOOKING_MARKER_MS / 60_000)} minutes) and was recovered while cancelling the return.`,
          failedAt: now.toISOString()
        });
        await returnShipment.save({ transaction });
      } else if (returnShipment && returnShipment.status === "cancelled") {
        returnShipment.cancelled_at ??= now;
        await returnShipment.save({ transaction });
      } else if (returnShipment) {
        const stage = classifyIThinkReverseCancellationStage(returnShipment.provider_status, returnShipment.status);
        if (stage === "cancelled") {
          returnShipment.status = "cancelled";
          returnShipment.cancelled_at ??= now;
          await returnShipment.save({ transaction });
        } else if (returnShipment.awb_number) {
          const existingIntent = readCancellationIntent(returnShipment.raw_payload);
          if (!existingIntent) {
            returnShipment.raw_payload = cancellationIntentPayload(returnShipment);
            await returnShipment.save({ transaction });
          }
          return { returnRequestId: returnRequest.id, shipmentId: returnShipment.id, awb: returnShipment.awb_number, existingIntent: Boolean(existingIntent), actor, reason };
        }
        // No AWB means no provider cancellation is required. The local
        // return can still be cancelled while the reverse row remains intact.
      }

      returnRequest.status = "cancelled";
      returnRequest.cancelled_at = now;
      returnRequest.cancellation_reason = reason ?? `Return cancelled by ${actor.source}.`;
      returnRequest.cancelled_by_user_id = actor.id;
      returnRequest.cancellation_source = actor.source;
      await returnRequest.save({ transaction });
      return null;
    });

    if (!operation) return;

    await sequelize.transaction(async (transaction) => {
      const returnRequest = await ReturnRequest.findByPk(operation.returnRequestId, { transaction, lock: transaction.LOCK.UPDATE });
      const returnShipment = await ReturnShipment.findByPk(operation.shipmentId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!returnRequest || !returnShipment || returnRequest.status === "cancelled") return;

      if (operation.existingIntent) {
        let tracked;
        try {
          tracked = await IThinkClient.track(operation.awb);
        } catch {
          throw new IThinkClientError("CANCELLATION_RECONCILIATION_UNCERTAIN", "iThink tracking could not reconcile the pending cancellation.", true);
        }
        const trackedStage = classifyIThinkReverseCancellationStage(tracked.currentStatus, returnShipment.status);
        if (trackedStage === "cancelled") {
          returnShipment.status = "cancelled";
          returnShipment.cancelled_at ??= new Date();
          returnShipment.provider_status = tracked.currentStatus ?? "Cancelled";
          await returnShipment.save({ transaction });
        } else if (trackedStage !== "pre_pickup") {
          throw new ReturnCancellationNotAllowedError("the provider reports that the reverse shipment has progressed beyond the cancellable pickup stage.");
        } else {
          // Still a pre-pickup scan and a cancellationIntent already on the
          // row: re-issue once, confirming rather than assuming (a rejection
          // is more likely "already cancelled" from the earlier attempt than
          // a genuine refusal). An unconfirmed result stays uncertain.
          await reissuePendingReverseCancellation(operation.awb, returnShipment.status);
          returnShipment.status = "cancelled";
          returnShipment.cancelled_at = new Date();
          returnShipment.provider_status = "Cancelled";
          await returnShipment.save({ transaction });
        }
      } else {
        await IThinkClient.cancel(operation.awb);
        returnShipment.status = "cancelled";
        returnShipment.cancelled_at = new Date();
        returnShipment.provider_status = "Cancelled";
        await returnShipment.save({ transaction });
      }

      returnRequest.status = "cancelled";
      returnRequest.cancelled_at = new Date();
      returnRequest.cancellation_reason = operation.reason ?? `Return cancelled by ${operation.actor.source}.`;
      returnRequest.cancelled_by_user_id = operation.actor.id;
      returnRequest.cancellation_source = operation.actor.source;
      await returnRequest.save({ transaction });
    });
  } catch (error) {
    if (error instanceof ReturnCancellationNotAllowedError || error instanceof ReturnCancellationProviderError) throw error;
    if (error instanceof IThinkClientError) {
      throw new ReturnCancellationProviderError(error.message, error.uncertain);
    }
    throw error;
  }
}

async function loadDetail(returnRequest: ReturnRequest): Promise<ReturnRequestDetailJSON> {
  const [order, orderItem, refunds, replacement, notes, returnShipment, payment] = await Promise.all([
    Order.findByPk(returnRequest.order_id),
    OrderItem.findByPk(returnRequest.order_item_id),
    Refund.findAll({ where: { return_request_id: returnRequest.id }, order: [["id", "DESC"]] }),
    Replacement.findOne({ where: { return_request_id: returnRequest.id } }),
    ReturnNote.findAll({ where: { return_request_id: returnRequest.id }, include: [{ model: User, as: "author" }], order: [["created_at", "ASC"]] }),
    ReturnShipmentService.getForReturnRequest(returnRequest.id),
    Payment.findOne({
      where: { order_id: returnRequest.order_id, status: ["paid", "partially_refunded"] },
      order: [["id", "DESC"]]
    })
  ]);

  if (!order || !orderItem) {
    // Invariant violation, not a caller-facing error: order_id/order_item_id
    // always come from rows this same service previously validated.
    throw new Error(`ReturnRequest '${returnRequest.id}' references a missing Order or OrderItem.`);
  }

  const shipment = replacement ? await Shipment.findOne({ where: { replacement_id: replacement.id }, include: [{ model: ShipmentTrackingEvent, as: "trackingEvents" }] }) : null;
  const base = toJSON(returnRequest, order, orderItem, refunds, replacement, shipment, returnShipment);
  const maxRefundableAmount = formatMoney(Number(orderItem.unit_price) * returnRequest.quantity);

  return {
    ...base,
    pickupAddress: resolvePickupAddress(returnRequest, order),
    canCancel: getReturnCancellationBlockReason({
      status: returnRequest.status,
      refunds,
      replacement,
      returnShipment
    }) === null,
    maxRefundableAmount,
    currency: order.currency,
    paymentProvider: payment?.provider ?? null,
    paymentMethod: payment?.method ?? null,
    notes: notes.map((note) => ({
      id: note.id,
      message: note.message,
      authorName: note.author?.name ?? "Admin",
      createdAt: note.created_at.toISOString()
    }))
  };
}

export const ReturnService = {
  /**
   * Item-level, backend-authoritative Return Request creation. Locks the
   * OrderItem row first — the same "lock the parent resource, then check +
   * write" pattern PaymentService/PaymentFinalizationService use for stock —
   * so two concurrent requests for the same OrderItem can never together
   * reserve more quantity than was purchased. Eligibility never trusts the
   * client for anything except which item/quantity/reason are being
   * requested; ownership, delivery state, and the return window are all
   * re-derived from persisted data.
   */
  async createReturnRequest(caller: ReturnCaller, input: CreateReturnRequestInput): Promise<ReturnRequestJSON> {
    const created = await sequelize.transaction(async (t) => {
      const order = await Order.findOne({ where: { id: input.orderId, user_id: caller.userId }, transaction: t, lock: t.LOCK.UPDATE });
      if (!order) {
        throw new OrderNotFoundError(input.orderId);
      }

      const orderItem = await OrderItem.findOne({
        where: { id: input.orderItemId, order_id: order.id },
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!orderItem) {
        throw new ReturnOrderItemNotFoundError(input.orderItemId);
      }

      // Delivery signal: order.status, not fulfilment_status. fulfilment_status
      // would be the more precise signal in principle, but no Shipping module
      // exists yet and nothing anywhere in this codebase (admin UI or API)
      // ever sets it away from its "unfulfilled" default — gating on it would
      // make every real Order permanently ineligible. order.status IS what
      // the real Admin "Order status" control actually advances to
      // "delivered". Both "delivered" and "return_requested" are accepted:
      // return_requested is the terminal value order.status itself flips to
      // below once the *first* Return is filed against this Order, and must
      // not block filing a second Return against a *different* OrderItem on
      // the same (still-delivered) Order.
      if (order.status !== "delivered" && order.status !== "return_requested") {
        throw new ReturnNotEligibleError("this item has not been delivered yet.");
      }

      const deliveredAt = await resolveDeliveredAt(order, t);
      const windowMs = paymentConfig.returnWindowDays * 24 * 60 * 60 * 1000;
      if (deliveredAt && Date.now() - deliveredAt.getTime() > windowMs) {
        throw new ReturnNotEligibleError(`the ${paymentConfig.returnWindowDays}-day return window has passed.`);
      }

      const consumed =
        (await ReturnRequest.sum("quantity", {
          where: { order_item_id: orderItem.id, status: { [Op.in]: [...QUANTITY_HOLDING_STATUSES] } },
          transaction: t
        })) ?? 0;
      const available = orderItem.quantity - consumed;
      if (input.quantity > available) {
        throw new ReturnQuantityExceedsAvailableError(input.quantity, Math.max(available, 0));
      }

      const returnId = await IdSequenceService.allocateNextId("return_requests", t);
      const returnRequest = await ReturnRequest.create(
        {
          id: returnId,
          return_number: buildBusinessReference("return", returnId),
          order_id: order.id,
          order_item_id: orderItem.id,
          quantity: input.quantity,
          user_id: caller.userId,
          type: input.resolution === "replacement" ? "replacement" : "return",
          status: "requested",
          reason: input.reason,
          resolution_note: null,
          evidence_image_key: null,
          evidence_image_url: null
        },
        { transaction: t }
      );

      // Order.status is a coarse "has an open return" flag, not the return's
      // own process state (see return.types.ts / RETURN_STATUS_VALUES) —
      // only advance it the first time; a second Return on the same Order
      // finds it already at "return_requested" and leaves it alone.
      if (order.status === "delivered" && getValidNextOrderStatuses(order.status).includes("return_requested")) {
        order.status = "return_requested";
        await order.save({ transaction: t });
      }

      return toJSON(returnRequest, order, orderItem, [], null);
    });

    await CommerceNotifications.returnRequested(created.id);
    return created;
  },

  async listCustomerReturns(caller: ReturnCaller, params: ListReturnsParams): Promise<ListReturnsResultJSON> {
    const where: Record<string, unknown> = { user_id: caller.userId };
    if (params.status) {
      where.status = params.status;
    }
    if (params.resolution) where.type = params.resolution === "replacement" ? "replacement" : "return";
    return listReturns(where, params);
  },

  async getCustomerReturn(caller: ReturnCaller, returnId: number): Promise<ReturnRequestDetailJSON> {
    const returnRequest = await ReturnRequest.findOne({ where: { id: returnId, user_id: caller.userId } });
    if (!returnRequest) {
      throw new ReturnRequestNotFoundError(returnId);
    }
    return loadDetail(returnRequest);
  },

  async cancelCustomerReturn(caller: ReturnCaller, returnId: number, reason?: string): Promise<ReturnRequestDetailJSON> {
    await cancelReturnRequest({ id: caller.userId, source: "customer" }, returnId, reason, caller.userId);
    return this.getCustomerReturn(caller, returnId);
  },

  async listAdminReturns(params: ListReturnsParams): Promise<ListReturnsResultJSON> {
    const where: Record<string, unknown> = {};
    if (params.status) {
      where.status = params.status;
    }
    if (params.resolution) where.type = params.resolution === "replacement" ? "replacement" : "return";
    return listReturns(where, params);
  },

  async getAdminReturn(returnId: number): Promise<ReturnRequestDetailJSON> {
    const returnRequest = await ReturnRequest.findByPk(returnId);
    if (!returnRequest) {
      throw new ReturnRequestNotFoundError(returnId);
    }
    return loadDetail(returnRequest);
  },

  async cancelAdminReturn(adminId: number, returnId: number, reason?: string): Promise<ReturnRequestDetailJSON> {
    await cancelReturnRequest({ id: adminId, source: "admin" }, returnId, reason);
    return this.getAdminReturn(returnId);
  },

  /**
   * Admin approve/reject. A return may only be reviewed once — this is a
   * one-way door, matching the spec's "approved cannot be accidentally
   * re-approved" / "rejected cannot initiate refund" test requirements.
   * Rejecting is immediately terminal (resolved_at stamped now); approving
   * is NOT terminal on its own — it only makes the Return refund-eligible.
   * Refund initiation (a separate, more tightly-gated action) is what a
   * successful Refund later closes out via RefundFinalizationService,
   * which is the only other writer of ReturnRequest.status/resolved_at.
   */
  async adminReviewReturn(adminId: number, returnId: number, input: AdminReviewReturnInput): Promise<ReturnRequestDetailJSON> {
    let createdReplacementId: number | null = null;

    await sequelize.transaction(async (t) => {
      const returnRequest = await ReturnRequest.findByPk(returnId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!returnRequest) {
        throw new ReturnRequestNotFoundError(returnId);
      }
      if (returnRequest.status !== "requested") {
        throw new ReturnAlreadyReviewedError(returnRequest.status);
      }

      // A "replacement" approval immediately consumes stock and readies a
      // new item to ship (see below) — unlike a "return" approval, which
      // only makes the request refund-eligible and leaves the actual money
      // movement to a separate, later initiateRefund call. That later call
      // gets its own item-received gate (RefundService.initiateRefund);
      // here, approval itself IS the trigger, so the gate has to sit here.
      if (input.action === "approve" && returnRequest.type === "replacement" && returnRequest.item_received_at === null) {
        throw new ReturnItemNotReceivedError(returnRequest.id);
      }

      if (input.action === "approve") {
        returnRequest.status = "approved";
      } else {
        returnRequest.status = "rejected";
        returnRequest.resolved_at = new Date();
      }
      if (input.note) {
        returnRequest.resolution_note = input.note;
      }
      await returnRequest.save({ transaction: t });

      if (input.action === "approve" && returnRequest.type === "replacement") {
        const replacement = await ReplacementService.createForApprovedReturn(adminId, returnRequest, t);
        createdReplacementId = replacement.id;
      }

      if (input.note) {
        const noteId = await IdSequenceService.allocateNextId("return_notes", t);
        await ReturnNote.create({ id: noteId, return_request_id: returnRequest.id, admin_id: adminId, message: input.note }, { transaction: t });
      }
    });

    // Post-commit — see payment-finalization.service.ts for why this always
    // happens after the transaction, never inside it.
    if (input.action === "approve") {
      await CommerceNotifications.returnApproved(returnId);
    } else {
      await CommerceNotifications.returnRejected(returnId);
    }
    if (createdReplacementId !== null) {
      // CommerceNotifications re-verifies the Replacement's actual persisted
      // status, so it always resolves to exactly one of these two — this
      // just picks which milestone to attempt.
      await CommerceNotifications.replacementApproved(createdReplacementId);
      await CommerceNotifications.replacementStockUnavailable(createdReplacementId);
    }

    return this.getAdminReturn(returnId);
  },

  async addAdminNote(adminId: number, returnId: number, message: string): Promise<ReturnRequestDetailJSON> {
    const returnRequest = await ReturnRequest.findByPk(returnId);
    if (!returnRequest) {
      throw new ReturnRequestNotFoundError(returnId);
    }
    const noteId = await sequelize.transaction((t) => IdSequenceService.allocateNextId("return_notes", t));
    await ReturnNote.create({ id: noteId, return_request_id: returnId, admin_id: adminId, message });
    return this.getAdminReturn(returnId);
  },

  /**
   * Warehouse-side confirmation that the physical item is actually back —
   * an operational fact, not a money movement, so any admin can record it
   * (unlike refund initiation, which stays super_admin-only). Deliberately
   * separate from approve/reject: it can be recorded before OR after
   * approval for a "return" (refund initiation checks it independently,
   * whenever it happens), but must happen BEFORE approval for a
   * "replacement" (approval itself consumes stock — see adminReviewReturn).
   * Allowed only while the request is still open ("requested" or
   * "approved") — a rejected or already-resolved request has nothing left
   * for this confirmation to gate.
   */
  async markItemReceived(adminId: number, returnId: number): Promise<ReturnRequestDetailJSON> {
    await sequelize.transaction(async (t) => {
      const returnRequest = await ReturnRequest.findByPk(returnId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!returnRequest) {
        throw new ReturnRequestNotFoundError(returnId);
      }
      if (returnRequest.status !== "requested" && returnRequest.status !== "approved") {
        throw new ReturnItemReceiptNotApplicableError(returnRequest.status);
      }
      if (returnRequest.item_received_at !== null) {
        throw new ReturnItemAlreadyReceivedError(returnId);
      }

      returnRequest.item_received_at = new Date();
      returnRequest.item_received_by_admin_id = adminId;
      await returnRequest.save({ transaction: t });
    });

    return this.getAdminReturn(returnId);
  },

  /**
   * Edit the reverse-pickup address for a return. Writes ONLY the
   * return_requests.pickup_* snapshot columns (migration 064) — never the
   * Order's own ship_* shipping snapshot, so order history is untouched.
   * Allowed only while a pickup can still be booked with the new address:
   * the return must be "approved" and must not already have a live
   * (non-failed) ReturnShipment. A failed ReturnShipment is fine — the admin
   * is expected to correct the address and retry.
   */
  async updatePickupAddress(returnId: number, input: UpdateReturnPickupAddressInput): Promise<ReturnRequestDetailJSON> {
    await sequelize.transaction(async (t) => {
      const returnRequest = await ReturnRequest.findByPk(returnId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!returnRequest) {
        throw new ReturnRequestNotFoundError(returnId);
      }
      if (returnRequest.status !== "approved") {
        throw new ReturnPickupAddressNotEditableError(`the return status is '${returnRequest.status}' (must be 'approved').`);
      }
      const returnShipment = await ReturnShipment.findOne({ where: { return_request_id: returnRequest.id }, transaction: t, lock: t.LOCK.UPDATE });
      if (returnShipment && returnShipment.status !== "failed") {
        throw new ReturnPickupAddressNotEditableError("a reverse pickup has already been booked with the courier.");
      }

      returnRequest.pickup_recipient_name = input.recipientName;
      returnRequest.pickup_phone = input.phone;
      returnRequest.pickup_line_1 = input.line1;
      returnRequest.pickup_line_2 = input.line2 ?? null;
      returnRequest.pickup_city = input.city;
      returnRequest.pickup_state = input.state;
      returnRequest.pickup_postal_code = input.postalCode;
      returnRequest.pickup_country = "IN";
      await returnRequest.save({ transaction: t });
    });

    return this.getAdminReturn(returnId);
  }
};

async function listReturns(where: Record<string, unknown>, params: ListReturnsParams): Promise<ListReturnsResultJSON> {
  const { rows, count } = await ReturnRequest.findAndCountAll({
    where,
    order: [["requested_at", "DESC"]],
    limit: params.pageSize,
    offset: (params.page - 1) * params.pageSize
  });

  const items = await Promise.all(
    rows.map(async (row) => {
      const [order, orderItem, refunds, replacement] = await Promise.all([
        Order.findByPk(row.order_id),
        OrderItem.findByPk(row.order_item_id),
        Refund.findAll({ where: { return_request_id: row.id }, order: [["id", "DESC"]] })
        ,Replacement.findOne({ where: { return_request_id: row.id } })
      ]);
      if (!order || !orderItem) {
        throw new Error(`ReturnRequest '${row.id}' references a missing Order or OrderItem.`);
      }
      return toJSON(row, order, orderItem, refunds, replacement);
    })
  );

  return { items, page: params.page, pageSize: params.pageSize, total: count };
}

// Best available "delivered at" signal: a Shipment row's own delivered_at is
// authoritative when the (not-yet-built) Shipping module has populated one,
// but nothing in this codebase creates Shipment rows yet (admin-order.routes.ts
// defers fulfilment/shipment endpoints to that future module — see the
// Returns + Refunds discovery report). Order.updated_at is the fallback: the
// only code path that ever sets fulfilment_status/order.status toward
// "delivered" is OrderService.updateStatus, which always touches updated_at
// in that same write, making it a reasonable (if approximate) proxy today.
async function resolveDeliveredAt(order: Order, transaction: Transaction): Promise<Date | null> {
  const shipment = await Shipment.findOne({
    where: { order_id: order.id, delivered_at: { [Op.ne]: null } },
    order: [["delivered_at", "DESC"]],
    transaction
  });
  if (shipment?.delivered_at) {
    return shipment.delivered_at;
  }
  return order.updated_at ?? null;
}
