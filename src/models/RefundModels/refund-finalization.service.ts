import { sequelize } from "../../database/index.js";
import { Order, Payment, Refund, ReturnRequest } from "../../database/tables/index.js";
import { logger } from "../../utils/logger.js";
import { parseMoneyToPaise } from "../../utils/product-money.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import type { NormalizedRefundResult, RefundFinalizationOutcome } from "./refund.types.js";

// Terminal for a single Refund row — once succeeded or failed, no later
// event (including a stale/replayed webhook) may ever change it again. This
// mirrors PaymentFinalizationService's TERMINAL_PAYMENT_STATUSES guard
// exactly, one level down the object graph.
const TERMINAL_REFUND_STATUSES = new Set(["succeeded", "failed"]);

function sanitizeMetadata(result: NormalizedRefundResult): Record<string, unknown> {
  // Never includes the PayU hash or salt — normalizeInitiateResponse/
  // normalizeStatusApiResponse already exclude both from safeMetadata.
  return {
    verifiedVia: result.verifiedVia,
    verifiedAt: result.verifiedAt.toISOString(),
    providerStatus: result.providerStatus,
    ...result.safeMetadata
  };
}

export const RefundFinalizationService = {
  /**
   * The ONE place Refund/Payment/Order/ReturnRequest state is ever mutated
   * by a real PayU refund outcome. All three signal sources — the
   * initiation call's own response, a manual Status API re-check, and the
   * refund webhook — normalize to the same NormalizedRefundResult shape and
   * converge here, exactly like PaymentFinalizationService for payments.
   * Never throws for an expected/handled outcome; only a genuine
   * data-integrity invariant violation throws.
   */
  async processVerifiedRefundResult(result: NormalizedRefundResult): Promise<RefundFinalizationOutcome> {
    const outcome = await sequelize.transaction(async (t): Promise<RefundFinalizationOutcome> => {
      // 1. Lock the Refund row by our own merchant refund token — the
      // idempotency guard for every replay/duplicate/racing signal, and
      // simultaneously how an unrecognized/spoofed token is rejected: it
      // simply matches no row.
      const refund = await Refund.findOne({ where: { provider_refund_token: result.merchantRefundToken }, transaction: t, lock: t.LOCK.UPDATE });
      if (!refund) {
        logger.warn({ token: result.merchantRefundToken }, "refund finalization: unknown merchant refund token, rejected without mutation");
        return { code: "REJECTED_UNKNOWN_REFUND", refundId: null, returnRequestId: null };
      }

      const logContext = { refundId: refund.id, returnRequestId: refund.return_request_id, paymentId: refund.payment_id };

      // Monotonicity: once a Refund reaches succeeded/failed, nothing later
      // — including a stale FAILED result arriving after a genuine SUCCESS
      // one — may change it again.
      if (TERMINAL_REFUND_STATUSES.has(refund.status)) {
        logger.info({ ...logContext, existingStatus: refund.status }, "refund finalization: already terminal, idempotent no-op");
        return { code: "NOOP_ALREADY_TERMINAL", refundId: refund.id, returnRequestId: refund.return_request_id };
      }

      // 2. Cross-check any provider-supplied amount against our own
      // persisted Refund snapshot — never trust the provider payload alone
      // for a SUCCEEDED verdict (mirrors PaymentFinalizationService's
      // REJECTED_AMOUNT_MISMATCH path).
      if (result.normalizedOutcome === "SUCCEEDED" && result.amount !== null) {
        let resultPaise: number;
        try {
          resultPaise = parseMoneyToPaise(result.amount);
        } catch {
          logger.warn(logContext, "refund finalization: malformed amount from provider, rejected");
          return { code: "REJECTED_AMOUNT_MISMATCH", refundId: refund.id, returnRequestId: refund.return_request_id };
        }
        if (resultPaise !== parseMoneyToPaise(refund.amount)) {
          logger.warn({ ...logContext, providerAmount: result.amount, refundAmount: refund.amount }, "refund finalization: amount mismatch, rejected");
          return { code: "REJECTED_AMOUNT_MISMATCH", refundId: refund.id, returnRequestId: refund.return_request_id };
        }
      }

      if (result.normalizedOutcome === "FAILED") {
        refund.status = "failed";
        refund.failed_at = new Date();
        refund.provider_status = result.providerStatus || refund.provider_status;
        refund.failure_message = result.providerStatus || null;
        refund.raw_payload = sanitizeMetadata(result);
        await refund.save({ transaction: t });
        logger.info(logContext, "refund finalization: recorded failure");
        return { code: "FAILED_RECORDED", refundId: refund.id, returnRequestId: refund.return_request_id };
      }

      if (result.normalizedOutcome === "PENDING") {
        // Only a meaningful transition once: "we handed this to PayU and it
        // was queued" (pending -> processing). A later PENDING result once
        // already processing carries no new information.
        if (refund.status === "pending") {
          refund.status = "processing";
          refund.provider_request_id = refund.provider_request_id || result.providerRequestId;
          refund.provider_status = result.providerStatus || refund.provider_status;
          await refund.save({ transaction: t });
          logger.info(logContext, "refund finalization: queued/processing by PayU");
          return { code: "PROCESSING_RECORDED", refundId: refund.id, returnRequestId: refund.return_request_id };
        }
        return { code: "NOOP_UNCERTAIN", refundId: refund.id, returnRequestId: refund.return_request_id };
      }

      // SUCCEEDED path from here down.
      refund.status = "succeeded";
      refund.completed_at = new Date();
      refund.provider_refund_id = result.providerRefundId || refund.provider_refund_id;
      refund.provider_status = result.providerStatus || refund.provider_status;
      refund.raw_payload = sanitizeMetadata(result);
      await refund.save({ transaction: t });

      // 3. Roll up the Payment's financial summary from every succeeded
      // Refund against it — never trust the provider callback to choose
      // this directly (spec §23). The original Payment.amount is never
      // overwritten; only .status/.refunded_at move.
      const payment = await Payment.findByPk(refund.payment_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (!payment) {
        // Invariant violation, not a caller-facing error: every Refund row
        // has a required payment_id FK.
        throw new Error(`Refund '${refund.id}' references missing Payment '${refund.payment_id}'.`);
      }

      const succeededTotal = (await Refund.sum("amount", { where: { payment_id: payment.id, status: "succeeded" }, transaction: t })) ?? 0;
      const isFullyRefunded = parseMoneyToPaise(succeededTotal) >= parseMoneyToPaise(payment.amount);
      payment.status = isFullyRefunded ? "refunded" : "partially_refunded";
      payment.refunded_at = payment.refunded_at ?? new Date();
      await payment.save({ transaction: t });

      const order = await Order.findByPk(payment.order_id, { transaction: t, lock: t.LOCK.UPDATE });
      if (order) {
        order.payment_status = isFullyRefunded ? "refunded" : "partially_refunded";
        await order.save({ transaction: t });
      }

      // 4. Close out the linked ReturnRequest — bookkeeping/process-state
      // only (the money has already moved by this point), never the other
      // way around. Only an "approved" Return that is still open moves to
      // "resolved"; already-resolved/rejected/requested are left alone.
      if (refund.return_request_id) {
        const returnRequest = await ReturnRequest.findByPk(refund.return_request_id, { transaction: t, lock: t.LOCK.UPDATE });
        if (returnRequest && returnRequest.status === "approved") {
          returnRequest.status = "resolved";
          returnRequest.resolved_at = new Date();
          await returnRequest.save({ transaction: t });
        }
      }

      logger.info({ ...logContext, isFullyRefunded }, "refund finalization: verified success, Payment/Order/Return updated");
      return { code: "SUCCEEDED_RECORDED", refundId: refund.id, returnRequestId: refund.return_request_id };
    });

    // Post-commit, same discipline as PaymentFinalizationService — see that
    // file's matching comment.
    if (outcome.code === "SUCCEEDED_RECORDED" && outcome.refundId) {
      await CommerceNotifications.refundSucceeded(outcome.refundId);
    } else if (outcome.code === "FAILED_RECORDED" && outcome.refundId) {
      await CommerceNotifications.refundFailed(outcome.refundId);
    }

    return outcome;
  }
};
