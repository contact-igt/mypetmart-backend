import { Op, type Transaction } from "sequelize";

import { paymentConfig } from "../../config/payment.config.js";
import { sequelize } from "../../database/index.js";
import { Order } from "../../database/tables/OrderTable/index.js";
import { OrderItem } from "../../database/tables/OrderItemTable/index.js";
import { Refund } from "../../database/tables/RefundTable/index.js";
import { Replacement } from "../../database/tables/ReplacementTable/index.js";
import { ReturnNote } from "../../database/tables/ReturnNoteTable/index.js";
import { ReturnRequest } from "../../database/tables/ReturnRequestTable/index.js";
import { Shipment } from "../../database/tables/ShipmentTable/index.js";
import { ShipmentTrackingEvent } from "../../database/tables/ShipmentTrackingEventTable/index.js";
import { User } from "../../database/tables/UserTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { formatMoney } from "../../utils/product-money.js";
import { getValidNextOrderStatuses } from "../OrderModels/order.constants.js";
import { OrderNotFoundError } from "../OrderModels/order.errors.js";
import { ReplacementService } from "../ReplacementModels/replacement.service.js";
import { ShipmentService } from "../ShipmentModels/shipment.service.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import {
  ReturnAlreadyReviewedError,
  ReturnItemAlreadyReceivedError,
  ReturnItemNotReceivedError,
  ReturnItemReceiptNotApplicableError,
  ReturnNotEligibleError,
  ReturnOrderItemNotFoundError,
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
  ReturnRequestJSON
} from "./return.types.js";

// Return process states that still "hold" their quantity against the
// OrderItem — a rejected request releases its quantity back to the pool
// (never happened), but requested/approved/resolved all keep it reserved
// (resolved means the return already completed, not that it should free up
// room for a second one).
const QUANTITY_HOLDING_STATUSES = ["requested", "approved", "resolved"] as const;

function toJSON(returnRequest: ReturnRequest, order: Order, orderItem: OrderItem, refunds: Refund[], replacement: Replacement | null, shipment: Shipment | null = null): ReturnRequestJSON {
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
    replacement: replacement ? ReplacementService.toJSON(replacement, shipment ? ShipmentService.toJSON(shipment) : null) : null
  };
}

async function loadDetail(returnRequest: ReturnRequest): Promise<ReturnRequestDetailJSON> {
  const [order, orderItem, refunds, replacement, notes] = await Promise.all([
    Order.findByPk(returnRequest.order_id),
    OrderItem.findByPk(returnRequest.order_item_id),
    Refund.findAll({ where: { return_request_id: returnRequest.id }, order: [["id", "DESC"]] }),
    Replacement.findOne({ where: { return_request_id: returnRequest.id } }),
    ReturnNote.findAll({ where: { return_request_id: returnRequest.id }, include: [{ model: User, as: "author" }], order: [["created_at", "ASC"]] })
  ]);

  if (!order || !orderItem) {
    // Invariant violation, not a caller-facing error: order_id/order_item_id
    // always come from rows this same service previously validated.
    throw new Error(`ReturnRequest '${returnRequest.id}' references a missing Order or OrderItem.`);
  }

  const shipment = replacement ? await Shipment.findOne({ where: { replacement_id: replacement.id }, include: [{ model: ShipmentTrackingEvent, as: "trackingEvents" }] }) : null;
  const base = toJSON(returnRequest, order, orderItem, refunds, replacement, shipment);
  const maxRefundableAmount = formatMoney(Number(orderItem.unit_price) * returnRequest.quantity);

  return {
    ...base,
    maxRefundableAmount,
    currency: order.currency,
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
