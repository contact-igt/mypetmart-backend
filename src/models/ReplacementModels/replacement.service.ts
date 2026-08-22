import type { Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { OrderItem, Product, ProductVariant, Replacement, ReturnNote, ReturnRequest } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { ReturnRequestNotFoundError } from "../ReturnModels/return.errors.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import {
  ReplacementCatalogUnavailableError,
  ReplacementInvalidStatusTransitionError,
  ReplacementNotFoundError,
  ReplacementResolutionMismatchError,
  ReplacementStockUnavailableError
} from "./replacement.errors.js";
import type { ReplacementJSON, UpdateReplacementInput } from "./replacement.types.js";
import type { ShipmentJSON } from "../ShipmentModels/shipment.types.js";

function toJSON(replacement: Replacement, shipment: ShipmentJSON | null = null): ReplacementJSON {
  return {
    id: replacement.id,
    replacementNumber: replacement.replacement_number,
    status: replacement.status,
    productId: replacement.product_id,
    productVariantId: replacement.product_variant_id,
    quantity: replacement.quantity,
    stockConsumedAt: replacement.stock_consumed_at?.toISOString() ?? null,
    completedAt: replacement.completed_at?.toISOString() ?? null,
    createdAt: replacement.created_at.toISOString(),
    ...(shipment ? { shipment } : {})
  };
}

async function addAuditNote(returnRequestId: number, adminId: number, message: string, transaction: Transaction): Promise<void> {
  const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.returnNotes, transaction);
  await ReturnNote.create({ id, return_request_id: returnRequestId, admin_id: adminId, message }, { transaction });
}

async function lockInventory(orderItem: OrderItem, quantity: number, transaction: Transaction) {
  if (orderItem.product_id === null) throw new ReplacementCatalogUnavailableError();

  // `paranoid: false` preserves the exact original catalog identity in the
  // Replacement record. Deleted/inactive catalog rows are truthfully treated
  // as unavailable and never consume stock.
  const product = await Product.findByPk(orderItem.product_id, { transaction, lock: transaction.LOCK.UPDATE, paranoid: false });
  if (!product) throw new ReplacementCatalogUnavailableError();

  if (orderItem.product_variant_id !== null) {
    const variant = await ProductVariant.findByPk(orderItem.product_variant_id, { transaction, lock: transaction.LOCK.UPDATE, paranoid: false });
    if (!variant || variant.product_id !== product.id) throw new ReplacementCatalogUnavailableError();
    return {
      product,
      variant,
      available: product.deleted_at === null && product.status === "active" && variant.deleted_at === null && variant.active && variant.stock >= quantity
    };
  }

  return {
    product,
    variant: null,
    available: product.deleted_at === null && product.status === "active" && product.stock >= quantity
  };
}

async function consumeStock(replacement: Replacement, transaction: Transaction): Promise<boolean> {
  if (replacement.stock_consumed_at) return true;
  const orderItem = await OrderItem.findByPk(replacement.order_item_id, { transaction });
  if (!orderItem) throw new ReplacementCatalogUnavailableError();
  const inventory = await lockInventory(orderItem, replacement.quantity, transaction);
  if (!inventory.available) return false;

  if (inventory.variant) {
    inventory.variant.stock -= replacement.quantity;
    await inventory.variant.save({ transaction });
  } else {
    inventory.product.stock -= replacement.quantity;
    await inventory.product.save({ transaction });
  }
  replacement.stock_consumed_at = new Date();
  return true;
}

export const ReplacementService = {
  toJSON,

  async createForApprovedReturn(adminId: number, returnRequest: ReturnRequest, transaction: Transaction): Promise<Replacement> {
    if (returnRequest.type !== "replacement") throw new ReplacementResolutionMismatchError();

    const orderItem = await OrderItem.findByPk(returnRequest.order_item_id, { transaction });
    if (!orderItem || orderItem.product_id === null) throw new ReplacementCatalogUnavailableError();

    const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.replacements, transaction);
    const replacement = Replacement.build({
      id,
      replacement_number: buildBusinessReference("replacement", id),
      return_request_id: returnRequest.id,
      order_id: returnRequest.order_id,
      order_item_id: returnRequest.order_item_id,
      product_id: orderItem.product_id,
      product_variant_id: orderItem.product_variant_id,
      quantity: returnRequest.quantity,
      status: "stock_unavailable",
      approved_by_admin_id: adminId,
      stock_consumed_at: null,
      completed_at: null
    });

    const allocated = await consumeStock(replacement, transaction);
    replacement.status = allocated ? "processing" : "stock_unavailable";
    await replacement.save({ transaction });
    await addAuditNote(
      returnRequest.id,
      adminId,
      allocated ? "Replacement approved; inventory allocated and processing started." : "Replacement approved; stock is currently unavailable.",
      transaction
    );
    return replacement;
  },

  async updateStatus(adminId: number, returnRequestId: number, input: UpdateReplacementInput): Promise<ReplacementJSON> {
    const result = await sequelize.transaction(async (transaction) => {
      const returnRequest = await ReturnRequest.findByPk(returnRequestId, { transaction, lock: transaction.LOCK.UPDATE });
      if (!returnRequest) throw new ReturnRequestNotFoundError(returnRequestId);
      if (returnRequest.type !== "replacement") throw new ReplacementResolutionMismatchError();

      const replacement = await Replacement.findOne({ where: { return_request_id: returnRequest.id }, transaction, lock: transaction.LOCK.UPDATE });
      if (!replacement) throw new ReplacementNotFoundError(returnRequest.id);
      if (replacement.status === input.status) return { json: toJSON(replacement), transitioned: false };

      if (replacement.status === "stock_unavailable" && input.status === "processing") {
        if (!(await consumeStock(replacement, transaction))) throw new ReplacementStockUnavailableError();
        replacement.status = "processing";
        await addAuditNote(returnRequest.id, adminId, "Replacement inventory allocated; processing started.", transaction);
      } else {
        throw new ReplacementInvalidStatusTransitionError(replacement.status, input.status);
      }

      await replacement.save({ transaction });
      return { json: toJSON(replacement), transitioned: true };
    });

    // Post-commit — the admin resolving a previously stock_unavailable
    // Replacement is exactly the REPLACEMENT_APPROVED moment for it (the
    // customer never got that email at creation time, since it started out
    // unavailable). No-ops if this call was itself a no-op (status already
    // matched, `transitioned: false`).
    if (result.transitioned) {
      await CommerceNotifications.replacementApproved(result.json.id);
    }
    return result.json;
  }
};
