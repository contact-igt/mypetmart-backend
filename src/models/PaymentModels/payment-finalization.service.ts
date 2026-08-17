import type { Transaction } from "sequelize";

import { DEFAULT_CURRENCY_CODE } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Order, OrderItem, Payment, Product, ProductVariant } from "../../database/tables/index.js";
import type { Product as ProductModel } from "../../database/tables/ProductTable/index.js";
import type { ProductVariant as ProductVariantModel } from "../../database/tables/ProductVariantTable/index.js";
import { logger } from "../../utils/logger.js";
import { parseMoneyToPaise } from "../../utils/product-money.js";
import { CartService } from "../CartModels/cart.service.js";
import { isValidOrderStatusTransition } from "../OrderModels/order.constants.js";
import type { FinalizationOutcome, NormalizedPaymentResult } from "./payment.types.js";

const TERMINAL_PAYMENT_STATUSES = new Set(["paid", "failed", "refunded", "cancelled"]);

type LockedLine = {
  item: OrderItem;
  product: ProductModel;
  variant: ProductVariantModel | null;
  availableStock: number;
};

function sanitizeMetadata(result: NormalizedPaymentResult): Record<string, unknown> {
  // Never includes the PayU hash or salt — the normalizer already excludes
  // both from safeMetadata, this just adds a few non-sensitive provenance
  // fields for admin visibility / support debugging.
  return {
    verifiedVia: result.verifiedVia,
    verifiedAt: result.verifiedAt.toISOString(),
    providerStatus: result.providerStatus,
    ...result.safeMetadata
  };
}

/**
 * Locks and re-checks stock for every OrderItem in deterministic
 * (product_id, product_variant_id) order — never request-dependent order —
 * to avoid cross-transaction deadlocks when two Orders share a product line.
 * Returns null if any line cannot be fulfilled (missing Product/Variant, or
 * insufficient stock); the caller treats that as all-or-nothing for the
 * whole Order, never a partial decrement.
 */
async function lockAndCheckOrderStock(orderId: number, transaction: Transaction): Promise<LockedLine[] | null> {
  const orderItems = await OrderItem.findAll({ where: { order_id: orderId }, transaction });
  const sortedItems = [...orderItems].sort((a, b) => {
    const productDelta = (a.product_id ?? 0) - (b.product_id ?? 0);
    if (productDelta !== 0) return productDelta;
    return (a.product_variant_id ?? 0) - (b.product_variant_id ?? 0);
  });

  const lockedLines: LockedLine[] = [];
  let sufficient = true;

  for (const item of sortedItems) {
    if (item.product_id === null) {
      sufficient = false;
      continue;
    }
    const product = await Product.findByPk(item.product_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!product) {
      sufficient = false;
      continue;
    }

    let variant: ProductVariantModel | null = null;
    let availableStock: number;
    if (item.product_variant_id !== null) {
      variant = await ProductVariant.findByPk(item.product_variant_id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!variant) {
        sufficient = false;
        continue;
      }
      availableStock = variant.stock;
    } else {
      availableStock = product.stock;
    }

    if (item.quantity > availableStock) {
      sufficient = false;
    }
    lockedLines.push({ item, product, variant, availableStock });
  }

  return sufficient ? lockedLines : null;
}

export const PaymentFinalizationService = {
  /**
   * The ONE place stock/Payment/Order/Cart state is ever mutated by a real
   * payment outcome. Both the webhook path and the Verify Payment API path
   * converge here after independently producing a NormalizedPaymentResult —
   * this function never trusts anything beyond that already-verified shape.
   * Never throws for an expected/handled outcome (unknown txnid, amount
   * mismatch, already-terminal replay) — callers (webhook controller,
   * status endpoint) always get a typed FinalizationOutcome back so they can
   * ack the provider without leaking internals. Only a genuine programmer/
   * data-integrity invariant violation throws.
   */
  async processVerifiedPaymentResult(result: NormalizedPaymentResult): Promise<FinalizationOutcome> {
    if (result.normalizedOutcome === "PENDING") {
      logger.info({ txnid: result.merchantTransactionId, verifiedVia: result.verifiedVia }, "payment finalization: uncertain result, no-op");
      return { code: "NOOP_UNCERTAIN", paymentId: null, orderId: null };
    }

    return sequelize.transaction(async (t) => {
      // 1. Lock the Payment row — the idempotency guard for every replay/
      // duplicate/racing verification path.
      const payment = await Payment.findOne({
        where: { provider_order_id: result.merchantTransactionId },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!payment) {
        logger.warn({ txnid: result.merchantTransactionId }, "payment finalization: unknown txnid, rejected without mutation");
        return { code: "REJECTED_UNKNOWN_PAYMENT", paymentId: null, orderId: null };
      }

      const logContext = { paymentAttemptId: payment.id, orderId: payment.order_id, txnid: result.merchantTransactionId };

      // Monotonicity: once a Payment reaches a terminal state, no later
      // event — including a stale FAILED result arriving after a genuine
      // PAID one — is ever allowed to change it again.
      if (TERMINAL_PAYMENT_STATUSES.has(payment.status)) {
        logger.info({ ...logContext, existingStatus: payment.status, normalizedOutcome: result.normalizedOutcome }, "payment finalization: already terminal, idempotent no-op");
        return { code: "NOOP_ALREADY_TERMINAL", paymentId: payment.id, orderId: payment.order_id };
      }

      // 2. Verify the provider result against the Payment's own persisted
      // snapshot — never the provider payload alone.
      if (payment.currency !== DEFAULT_CURRENCY_CODE) {
        logger.error(logContext, "payment finalization: persisted Payment currency is not the configured default, rejected");
        return { code: "REJECTED_CURRENCY_MISMATCH", paymentId: payment.id, orderId: payment.order_id };
      }

      if (result.normalizedOutcome === "SUCCESS") {
        let resultPaise: number;
        try {
          resultPaise = parseMoneyToPaise(result.amount);
        } catch {
          logger.warn(logContext, "payment finalization: malformed amount from provider, rejected");
          return { code: "REJECTED_AMOUNT_MISMATCH", paymentId: payment.id, orderId: payment.order_id };
        }
        if (resultPaise !== parseMoneyToPaise(payment.amount)) {
          logger.warn(logContext, "payment finalization: amount mismatch, rejected");
          return { code: "REJECTED_AMOUNT_MISMATCH", paymentId: payment.id, orderId: payment.order_id };
        }
      }

      // FAILED/CANCELLED path — no Order/stock/Cart mutation, Order stays
      // payable so a new Payment attempt can retry.
      if (result.normalizedOutcome === "FAILED" || result.normalizedOutcome === "CANCELLED") {
        payment.status = result.normalizedOutcome === "FAILED" ? "failed" : "cancelled";
        payment.failed_at = new Date();
        await payment.save({ transaction: t });
        logger.info({ ...logContext, normalizedOutcome: result.normalizedOutcome }, "payment finalization: recorded failure");
        return { code: "FAILED_RECORDED", paymentId: payment.id, orderId: payment.order_id };
      }

      // SUCCESS path from here down.
      // 3. Lock the parent Order row.
      const order = await Order.findByPk(payment.order_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!order) {
        // Invariant violation, not a caller-facing error: every Payment row
        // has a required order_id FK.
        throw new Error(`Payment '${payment.id}' references missing Order '${payment.order_id}'.`);
      }

      if (order.payment_status === "paid") {
        // Reconcile this attempt to paid if a concurrent/earlier verified
        // event already finalized the Order — never repeat stock/Cart mutation.
        if (payment.status !== "paid") {
          payment.status = "paid";
          payment.paid_at = payment.paid_at ?? new Date();
          payment.provider_payment_id = payment.provider_payment_id ?? result.providerPaymentId;
          payment.method = payment.method ?? result.method;
          payment.raw_payload = sanitizeMetadata(result);
          await payment.save({ transaction: t });
        }
        logger.info(logContext, "payment finalization: order already paid, idempotent no-op");
        return { code: "NOOP_ALREADY_TERMINAL", paymentId: payment.id, orderId: order.id };
      }

      const canConfirm = isValidOrderStatusTransition(order.status, "confirmed");

      // 4. Lock and re-check stock (only when the Order could actually be
      // confirmed — no point locking inventory for an Order that was
      // independently cancelled while this Payment was in flight).
      const lockedLines = canConfirm ? await lockAndCheckOrderStock(order.id, t) : null;

      payment.status = "paid";
      payment.paid_at = new Date();
      payment.provider_payment_id = result.providerPaymentId;
      payment.method = result.method;
      payment.raw_payload = sanitizeMetadata(result);
      await payment.save({ transaction: t });

      order.payment_status = "paid";

      if (canConfirm && lockedLines) {
        // 5. Atomically decrement stock exactly once — the first and only
        // point stock is ever mutated.
        for (const line of lockedLines) {
          if (line.variant) {
            line.variant.stock = line.availableStock - line.item.quantity;
            await line.variant.save({ transaction: t });
          } else {
            line.product.stock = line.availableStock - line.item.quantity;
            await line.product.save({ transaction: t });
          }
        }
        order.status = "confirmed";
        await order.save({ transaction: t });

        // 6. Finalize the originating Cart exactly once.
        await CartService.finalizeCartForOrder(order, t);

        logger.info(logContext, "payment finalization: verified success, Order confirmed, stock decremented, Cart finalized");
        return { code: "SUCCESS_CONFIRMED", paymentId: payment.id, orderId: order.id };
      }

      // Paid-but-unfulfillable exception: PayU genuinely captured the
      // money, so Payment/Order.payment_status stay "paid", but the Order
      // is left exactly where it was (never advanced to "confirmed") and
      // flagged for manual review. No stock decrement, no Cart mutation.
      order.commerce_exception = canConfirm ? "inventory_unavailable" : "order_not_confirmable";
      await order.save({ transaction: t });

      logger.error({ ...logContext, commerceException: order.commerce_exception }, "payment finalization: captured but could not confirm Order — commerce exception recorded");
      return { code: "SUCCESS_COMMERCE_EXCEPTION", paymentId: payment.id, orderId: order.id };
    });
  }
};
