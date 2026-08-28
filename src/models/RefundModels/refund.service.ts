import type { Transaction } from "sequelize";

import { paymentConfig } from "../../config/payment.config.js";
import { sequelize } from "../../database/index.js";
import type { Order } from "../../database/tables/OrderTable/index.js";
import { OrderItem, Payment, Refund, ReturnRequest } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { formatMoney, parseMoneyToPaise } from "../../utils/product-money.js";
import { logger } from "../../utils/logger.js";
import { ReturnItemNotReceivedError, ReturnRequestNotFoundError } from "../ReturnModels/return.errors.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import { PayuRefundClient } from "./payu-refund.client.js";
import { normalizeInitiateResponse, normalizeStatusApiResponse } from "./refund-result-normalizer.js";
import { RefundFinalizationService } from "./refund-finalization.service.js";
import {
  RefundAlreadyInitiatedError,
  RefundCodManualProcessingRequiredError,
  RefundExceedsRefundableBalanceError,
  RefundNoPaidPaymentFoundError,
  RefundNotFoundError,
  RefundPaymentMissingProviderIdError,
  RefundProviderNotConfiguredError,
  RefundResolutionMismatchError,
  RefundReturnNotApprovedError
} from "./refund.errors.js";
import type { InitiateRefundResultJSON, RefundFinalizationOutcome } from "./refund.types.js";

// A Refund already in one of these states means initiation for this Return
// is already underway or done — a repeated click/request must not create a
// second concurrent provider request (spec §16/§28: idempotency + "duplicate
// initiation disabled"). Only "failed" leaves room for a genuinely new
// attempt (a fresh logical action, with its own new token).
const ACTIVE_REFUND_STATUSES = ["pending", "processing", "succeeded"] as const;

function assertOnlineRefundPayment(payment: Payment): void {
  if (payment.provider.toLowerCase() === "cod" || payment.method?.toLowerCase() === "cod") {
    throw new RefundCodManualProcessingRequiredError(payment.id);
  }
  if (!payment.provider_payment_id) {
    throw new RefundPaymentMissingProviderIdError(payment.id);
  }
}

async function loadRefundedTotalPaise(paymentId: number): Promise<number> {
  const total = (await Refund.sum("amount", { where: { payment_id: paymentId, status: "succeeded" } })) ?? 0;
  return parseMoneyToPaise(total);
}

/**
 * Calls PayU to actually move the money for an already-committed, still-
 * "pending" Refund row, then converges the result through the same
 * finalization path every other refund signal (webhook, manual recheck)
 * uses. Deliberately outside any DB transaction — the Refund row (and its
 * stable provider_refund_token) must already be durably committed before
 * this runs, so a network retry or duplicate call can never produce two
 * provider requests for the same logical action. A network/transport
 * failure here is NOT the same as PayU rejecting the request — the Refund
 * simply stays "pending" for later reconciliation (recheck or webhook).
 */
async function dispatchRefund(refundId: number): Promise<void> {
  const refund = await Refund.findByPk(refundId);
  if (!refund) {
    throw new Error(`Refund '${refundId}' was expected to already exist (created in an earlier committed transaction) but was not found.`);
  }
  const payment = await Payment.findByPk(refund.payment_id);
  if (!payment?.provider_payment_id || !paymentConfig.refundWebhookUrl) {
    // Invariant violation — both were already validated at Refund-creation
    // time and refundReady guarantees a webhook URL exists.
    throw new Error(`Refund '${refund.id}' is missing its Payment provider id or refund webhook URL at call time.`);
  }

  try {
    const raw = await PayuRefundClient.initiateRefund(payment.provider_payment_id, refund.provider_refund_token, refund.amount, paymentConfig.refundWebhookUrl);
    const normalized = normalizeInitiateResponse(refund.provider_refund_token, raw);
    await RefundFinalizationService.processVerifiedRefundResult(normalized);
  } catch (error) {
    logger.warn({ err: error, refundId: refund.id }, "refund initiation: PayU network call failed, Refund remains pending for later reconciliation");
  }
}

export const RefundService = {
  /**
   * Backend-authoritative refund initiation. Amount is always derived from
   * the immutable OrderItem price snapshot × the approved Return's own
   * quantity — never client-supplied (spec §14). The Refund row (with its
   * stable, server-generated provider_refund_token) is created and
   * committed in its own transaction BEFORE the PayU network call, so a
   * network retry or a duplicate click can never produce two provider
   * requests for the same logical action (spec §16) — the ACTIVE_REFUND_STATUSES
   * check above is what actually enforces "one at a time" on retry.
   */
  async initiateRefund(adminId: number, returnRequestId: number): Promise<InitiateRefundResultJSON> {
    const refund = await sequelize.transaction(async (t) => {
      const returnRequest = await ReturnRequest.findByPk(returnRequestId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!returnRequest) {
        throw new ReturnRequestNotFoundError(returnRequestId);
      }
      if (returnRequest.status !== "approved") {
        throw new RefundReturnNotApprovedError(returnRequest.status);
      }
      if (returnRequest.type !== "return") {
        throw new RefundResolutionMismatchError();
      }
      // The item-received gate: closes the same trust gap for a refund that
      // adminReviewReturn closes for a replacement, just one step later in
      // this flow — approving a "return" only makes it refund-eligible,
      // this initiation call is the actual money-moving trigger.
      if (returnRequest.item_received_at === null) {
        throw new ReturnItemNotReceivedError(returnRequest.id);
      }

      const existingActive = await Refund.findOne({
        where: { return_request_id: returnRequest.id, status: ACTIVE_REFUND_STATUSES as unknown as string[] },
        transaction: t
      });
      if (existingActive) {
        throw new RefundAlreadyInitiatedError(returnRequest.id);
      }

      const orderItem = await OrderItem.findByPk(returnRequest.order_item_id, { transaction: t });
      if (!orderItem) {
        throw new Error(`ReturnRequest '${returnRequest.id}' references a missing OrderItem '${returnRequest.order_item_id}'.`);
      }

      // The most recent successful (fully or partially refunded) Payment on
      // this Order — never a client-supplied Payment id.
      const payment = await Payment.findOne({
        where: { order_id: returnRequest.order_id, status: ["paid", "partially_refunded"] },
        order: [["id", "DESC"]],
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!payment) {
        throw new RefundNoPaidPaymentFoundError(returnRequest.order_id);
      }
      assertOnlineRefundPayment(payment);
      if (!paymentConfig.refundReady) {
        throw new RefundProviderNotConfiguredError();
      }

      const amount = formatMoney(Number(orderItem.unit_price) * returnRequest.quantity);
      const amountPaise = parseMoneyToPaise(amount);
      const alreadyRefundedPaise = await loadRefundedTotalPaise(payment.id);
      const remainingPaise = parseMoneyToPaise(payment.amount) - alreadyRefundedPaise;
      if (amountPaise > remainingPaise) {
        throw new RefundExceedsRefundableBalanceError(amount, formatMoney(remainingPaise / 100));
      }

      const refundId = await IdSequenceService.allocateNextId("refunds", t);
      const refundNumber = buildBusinessReference("refund", refundId);
      return Refund.create(
        {
          id: refundId,
          refund_number: refundNumber,
          order_id: returnRequest.order_id,
          payment_id: payment.id,
          return_request_id: returnRequest.id,
          provider: "payu",
          // refund_number ("REF-000123") is well under PayU's 23-character
          // limit on this field — reused directly rather than minting a
          // second identifier.
          provider_refund_token: refundNumber,
          provider_request_id: null,
          provider_refund_id: null,
          provider_status: null,
          status: "pending",
          amount,
          currency: payment.currency,
          failure_code: null,
          failure_message: null,
          initiated_by_admin_id: adminId,
          raw_payload: null
        },
        { transaction: t }
      );
    });

    // REFUND_INITIATED fires as soon as the Refund row is durably committed
    // — "initiated" describes our own decision to refund, not PayU's
    // acknowledgement of it, so this doesn't wait on dispatchRefund below.
    await CommerceNotifications.refundInitiated(refund.id);

    // Network call deliberately outside the transaction above — the Refund
    // row (and its token) is already durably committed, matching the same
    // "commit first, call the provider after" discipline PayuVerifyClient's
    // callers already follow.
    await dispatchRefund(refund.id);

    const refreshed = await Refund.findByPk(refund.id);
    const finalRefund = refreshed ?? refund;
    return {
      id: finalRefund.id,
      refundNumber: finalRefund.refund_number,
      status: finalRefund.status,
      amount: finalRefund.amount,
      currency: finalRefund.currency
    };
  },

  /**
   * Creates (but does not yet dispatch to PayU) a Refund row for a paid
   * Order being cancelled — the order-cancellation counterpart to
   * initiateRefund's Return-flow path, sharing the same Refund table and
   * finalization logic but with no ReturnRequest involved (return_request_id
   * is nullable for exactly this reason). Called by OrderModels/order.service.ts
   * from WITHIN the same transaction that flips the Order to "cancelled" and
   * restores stock, so cancellation, stock-restore and refund-row-creation
   * commit together as one atomic unit. The caller is responsible for
   * calling dispatchRefund(refund.id) AFTER that transaction commits — the
   * PayU network call must never happen inside an open DB transaction.
   */
  async createPendingCancellationRefund(adminId: number, order: Order, transaction: Transaction): Promise<Refund> {
    // Most recent paid Payment for this Order — never a client-supplied
    // Payment id. Locked so a concurrent cancellation attempt (shouldn't be
    // possible once the Order's own row is locked by the caller, but this
    // keeps the guarantee local to this function too) can't race it.
    const payment = await Payment.findOne({
      where: { order_id: order.id, status: "paid" },
      order: [["id", "DESC"]],
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!payment) {
      throw new RefundNoPaidPaymentFoundError(order.id);
    }
    assertOnlineRefundPayment(payment);
    if (!paymentConfig.refundReady) {
      throw new RefundProviderNotConfiguredError();
    }

    const existingActive = await Refund.findOne({
      where: { payment_id: payment.id, status: ACTIVE_REFUND_STATUSES as unknown as string[] },
      transaction
    });
    if (existingActive) {
      // Cancellation is a one-way, one-time transition (isValidOrderStatusTransition
      // never allows re-entering "cancelled"), so this only guards an
      // otherwise-impossible race rather than normal operation.
      return existingActive;
    }

    // A cancelled Order was never delivered and never went through the
    // Return flow, so nothing could have been refunded against this Payment
    // yet — the full captured amount is refundable.
    const amount = payment.amount;
    const refundId = await IdSequenceService.allocateNextId("refunds", transaction);
    const refundNumber = buildBusinessReference("refund", refundId);
    return Refund.create(
      {
        id: refundId,
        refund_number: refundNumber,
        order_id: order.id,
        payment_id: payment.id,
        return_request_id: null,
        provider: "payu",
        provider_refund_token: refundNumber,
        provider_request_id: null,
        provider_refund_id: null,
        provider_status: null,
        status: "pending",
        amount,
        currency: payment.currency,
        failure_code: null,
        failure_message: null,
        initiated_by_admin_id: adminId,
        raw_payload: null
      },
      { transaction }
    );
  },

  /** Exposed so OrderModels/order.service.ts can dispatch a cancellation-triggered Refund once its own transaction has committed. */
  dispatchRefund,

  /**
   * Admin-triggered manual re-check ("Check Again") for a Refund still
   * awaiting a terminal outcome — calls PayU's Status API directly rather
   * than waiting on the webhook, then converges through the same
   * finalization path.
   */
  async recheckRefundStatus(refundId: number): Promise<InitiateRefundResultJSON> {
    const refund = await Refund.findByPk(refundId);
    if (!refund) {
      throw new RefundNotFoundError(refundId);
    }
    if (refund.provider_request_id) {
      try {
        const raw = await PayuRefundClient.checkRefundStatus(refund.provider_request_id);
        const normalized = normalizeStatusApiResponse(refund.provider_refund_token, refund.provider_request_id, raw);
        await RefundFinalizationService.processVerifiedRefundResult(normalized);
      } catch (error) {
        logger.warn({ err: error, refundId: refund.id }, "refund status re-check: PayU network call failed, returning last-known local state");
      }
    }
    const refreshed = (await Refund.findByPk(refundId)) ?? refund;
    return {
      id: refreshed.id,
      refundNumber: refreshed.refund_number,
      status: refreshed.status,
      amount: refreshed.amount,
      currency: refreshed.currency
    };
  },

  /**
   * Refund webhook entry point. PayU's refund-status callback documents no
   * hash/signature field (unlike the payment webhook's reverse-hash) — so
   * its own `status` claim is never trusted directly. It is treated purely
   * as a hint to re-verify via the authoritative Status API using the
   * `request_id` already persisted on our own Refund row, keyed by the
   * `token` field (which is exactly our provider_refund_token). An unknown
   * token or a Refund with no provider_request_id yet is acked without any
   * mutation — there is nothing safe to act on yet.
   */
  async handleRefundWebhook(token: string | undefined): Promise<RefundFinalizationOutcome | null> {
    if (!token) {
      return null;
    }
    const refund = await Refund.findOne({ where: { provider_refund_token: token } });
    if (!refund || !refund.provider_request_id) {
      logger.info({ token }, "refund webhook: unknown token or no request_id on record yet, acked without verification");
      return null;
    }

    try {
      const raw = await PayuRefundClient.checkRefundStatus(refund.provider_request_id);
      const normalized = normalizeStatusApiResponse(refund.provider_refund_token, refund.provider_request_id, raw);
      return RefundFinalizationService.processVerifiedRefundResult(normalized);
    } catch (error) {
      logger.warn({ err: error, refundId: refund.id }, "refund webhook: Status API re-verification failed");
      return null;
    }
  }
};
