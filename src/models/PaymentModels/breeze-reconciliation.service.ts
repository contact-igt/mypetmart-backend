import { Op, type Transaction } from "sequelize";

import { sequelize } from "../../database/index.js";
import { BreezeAdminActionRecord, BreezeCheckoutSession, BreezeWebhookEvent, Order } from "../../database/tables/index.js";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { PaymentError } from "./payment.errors.js";
import { BREEZE_CHECKOUT_EXPECTED_DURATION_MS, BREEZE_RECONCILE_MAX_ATTEMPTS, reconciliationBackoffMs } from "./breeze-reconciliation.job.js";
import { breezeOrderCreateSchema } from "./breeze-order-create.schema.js";
import { BreezeOrderCreateService } from "./breeze-order-create.service.js";

// Staff reconciliation operations for Breeze checkouts and webhook events.
//
// Authorization is enforced by the route layer (authenticate("admin") +
// authorize). Every mutating action:
//   1. validates a reason (required, audited),
//   2. claims the row with a compare-and-set (no two actors/workers at once),
//   3. re-runs the SAME bridge gates: BREEZE_AMOUNT_UNIT, the explicit-status
//      rule, amount/currency checks, COD and partial refusal, and
//      PaymentFinalizationService. There is no force-paid path and no amount
//      input,
//   4. writes an append-only audit row with the resulting outcome.
//
// A manual retry can therefore never turn an unknown or unconfirmed outcome into
// success: the bridge still holds it.

export class BreezeReconciliationError extends PaymentError {
  public constructor(code: string, message: string, statusCode = 409, details?: unknown) {
    super(code, message, statusCode, details);
    this.name = "BreezeReconciliationError";
  }
}

const MIN_REASON_LENGTH = 10;
export const BREEZE_RELEASE_CONFIRMATION = "NO_PROVIDER_CAPTURE_CONFIRMED";

function normalizeReason(reason: unknown): string {
  const text = typeof reason === "string" ? reason.trim() : "";
  if (text.length < MIN_REASON_LENGTH || text.length > 500) {
    throw new BreezeReconciliationError("REASON_REQUIRED", `A reason of ${MIN_REASON_LENGTH}-500 characters is required for an audited action.`, 422);
  }
  return text;
}

function parseJson(raw: unknown): unknown {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  return raw;
}

/** Read model for the admin screen. No payloads, no contact details, no credentials. */
export async function listBreezeReconciliation(now: Date = new Date()) {
  const sessions = await BreezeCheckoutSession.findAll({
    where: { processing_status: { [Op.ne]: "finalized" } },
    order: [["updated_at", "DESC"]],
    limit: 100
  });
  const orderIds = sessions.map((s) => s.order_id).filter((id): id is number => id !== null);
  const orders = orderIds.length ? await Order.findAll({ attributes: ["id", "order_number", "payment_status", "commerce_exception"], where: { id: orderIds } }) : [];
  const orderById = new Map(orders.map((o) => [o.id, o]));

  const sessionRows = sessions.map((s) => {
    const order = s.order_id !== null ? orderById.get(s.order_id) : undefined;
    const ageMs = now.getTime() - new Date(s.created_at).getTime();
    return {
      checkoutRef: s.id,
      launchStatus: s.status,
      processingStatus: s.processing_status,
      orderId: s.order_id,
      orderNumber: order?.order_number ?? null,
      orderPaymentStatus: order?.payment_status ?? null,
      commerceException: order?.commerce_exception ?? null,
      paymentId: s.payment_id,
      breezeOrderId: s.breeze_order_id,
      breezeTransactionId: s.breeze_txn_id,
      breezeCartId: s.breeze_cart_id,
      lastErrorCode: s.last_error_code,
      unresolvedTooLong: s.processing_status === "awaiting_webhook" && s.order_id === null && ageMs > BREEZE_CHECKOUT_EXPECTED_DURATION_MS,
      expiresAt: s.expires_at,
      createdAt: s.created_at,
      updatedAt: s.updated_at
    };
  });

  const events = await BreezeWebhookEvent.findAll({
    where: { event_kind: "order_create", status: { [Op.in]: ["received", "reconciliation_required"] } },
    order: [["updated_at", "DESC"]],
    limit: 100
  });
  const eventRows = events.map((e) => {
    const eligibleAt = new Date(new Date(e.updated_at).getTime() + reconciliationBackoffMs(e.attempts));
    const retryable = e.status === "received" && e.attempts < BREEZE_RECONCILE_MAX_ATTEMPTS;
    return {
      eventRef: e.id,
      providerEventId: e.event_id,
      eventName: e.event_name,
      webhookState: e.status,
      outcomeCode: e.outcome_code,
      attempts: e.attempts,
      maxAttempts: BREEZE_RECONCILE_MAX_ATTEMPTS,
      retryEligible: retryable,
      nextAutomaticRetryAt: retryable ? eligibleAt : null,
      reconciliationReason: e.status === "reconciliation_required" ? (e.outcome_code ?? "UNSPECIFIED") : null,
      // A refund report is shown as "reported, unverified": Breeze exposes no
      // verified refund API, so it is never shown as completed.
      refundState: e.outcome_code === "PROVIDER_REFUND_REPORTED" ? "reported_unverified" : null,
      updatedAt: e.updated_at
    };
  });

  return { sessions: sessionRows, events: eventRows, generatedAt: now };
}

/** Append-only audit row. Written in the same transaction as a release. */
async function writeAdminAudit(
  input: { actorUserId: number; action: "retry_event" | "release_session"; targetType: string; targetId: number; reason: string; outcomeCode: string },
  transaction?: Transaction
): Promise<void> {
  const write = async (t: Transaction) => {
    const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.breezeAdminActions, t);
    await BreezeAdminActionRecord.create(
      { id, actor_user_id: input.actorUserId, action: input.action, target_type: input.targetType, target_id: input.targetId, reason: input.reason, outcome_code: input.outcomeCode },
      { transaction: t }
    );
  };
  if (transaction) return write(transaction);
  await sequelize.transaction(write);
}

export type BreezeRetryResult = { eventRef: number; outcomeCode: string | null; webhookState: string; httpStatus: number };

/**
 * Staff-triggered retry of one stored Order Create event. Claims the row first,
 * then re-runs the authenticated stored payload through the normal bridge. The
 * bridge's gates decide the outcome; this function never sets a payment status.
 */
export async function retryBreezeEventAsStaff(eventRef: number, actorUserId: number, reason: unknown): Promise<BreezeRetryResult> {
  const text = normalizeReason(reason);
  const row = await BreezeWebhookEvent.findByPk(eventRef);
  if (!row || row.event_kind !== "order_create") {
    throw new BreezeReconciliationError("EVENT_NOT_FOUND", "Webhook event not found.", 404);
  }
  if (row.status !== "received" && row.status !== "reconciliation_required") {
    throw new BreezeReconciliationError("EVENT_NOT_RETRYABLE", "This webhook event is already concluded and cannot be retried.", 409, { webhookState: row.status });
  }

  // Compare-and-set claim: a concurrent sweep or another staff member loses cleanly.
  const [claimed] = await BreezeWebhookEvent.update(
    { attempts: row.attempts + 1, updated_at: new Date() },
    { where: { id: row.id, status: row.status, attempts: row.attempts } }
  );
  if (claimed !== 1) {
    throw new BreezeReconciliationError("EVENT_CLAIMED_ELSEWHERE", "This event is being processed by another worker. Refresh and check its state.", 409);
  }

  let httpStatus = 200;
  let handlerError: unknown = null;
  try {
    const parsed = breezeOrderCreateSchema.safeParse(parseJson(row.payload));
    if (!parsed.success) {
      await BreezeWebhookEvent.update({ status: "reconciliation_required", outcome_code: "STORED_PAYLOAD_INVALID" }, { where: { id: row.id } });
    } else {
      const ack = await BreezeOrderCreateService.handle(parsed.data, { alreadyCountedAttempt: true });
      httpStatus = ack.httpStatus;
    }
  } catch (error) {
    handlerError = error;
    httpStatus = 500;
  }

  const after = await BreezeWebhookEvent.findByPk(row.id);
  const outcomeCode = handlerError ? "HANDLER_ERROR" : (after?.outcome_code ?? null);
  await writeAdminAudit({ actorUserId, action: "retry_event", targetType: "breeze_webhook_event", targetId: row.id, reason: text, outcomeCode: outcomeCode ?? "NONE" });

  if (handlerError) throw handlerError instanceof Error ? handlerError : new Error("Breeze retry handler failed.");
  return { eventRef: row.id, outcomeCode, webhookState: after?.status ?? row.status, httpStatus };
}

export type BreezeReleaseResult = { checkoutRef: number; outcomeCode: string };

/**
 * Super-admin release of an awaiting_webhook checkout that staff have CONFIRMED
 * will never be captured (e.g. checked in the Breeze dashboard). This is the
 * documented manual resolution that unblocks the customer. It is refused for any
 * session that has an order or a webhook result, so it can never hide a capture.
 * The confirmation phrase must be sent explicitly.
 */
export async function releaseBreezeCheckoutAsStaff(checkoutRef: number, actorUserId: number, reason: unknown, confirmation: unknown): Promise<BreezeReleaseResult> {
  const text = normalizeReason(reason);
  if (confirmation !== BREEZE_RELEASE_CONFIRMATION) {
    throw new BreezeReconciliationError("RELEASE_NOT_CONFIRMED", `Send the confirmation "${BREEZE_RELEASE_CONFIRMATION}" after checking the provider dashboard.`, 422);
  }
  const outcome = await sequelize.transaction(async (t) => {
    const session = await BreezeCheckoutSession.findByPk(checkoutRef, { transaction: t, lock: t.LOCK.UPDATE });
    if (!session) throw new BreezeReconciliationError("CHECKOUT_NOT_FOUND", "Checkout not found.", 404);
    if (session.processing_status !== "awaiting_webhook" || session.order_id !== null) {
      throw new BreezeReconciliationError("RELEASE_NOT_ALLOWED", "Only an unresolved checkout with no order can be released.", 409, { processingStatus: session.processing_status });
    }
    const [affected] = await BreezeCheckoutSession.update(
      { processing_status: "released", status: "expired" },
      { where: { id: session.id, processing_status: "awaiting_webhook", order_id: null }, transaction: t }
    );
    if (affected !== 1) {
      throw new BreezeReconciliationError("RELEASE_RACED", "This checkout changed while being released. Refresh and check again.", 409);
    }
    await writeAdminAudit({ actorUserId, action: "release_session", targetType: "breeze_checkout_session", targetId: session.id, reason: text, outcomeCode: "RELEASED" }, t);
    return "RELEASED";
  });
  return { checkoutRef, outcomeCode: outcome };
}

export async function listBreezeAdminActions(limit = 50) {
  const rows = await BreezeAdminActionRecord.findAll({ order: [["id", "DESC"]], limit: Math.min(limit, 200) });
  return rows.map((r) => ({ id: r.id, actorUserId: r.actor_user_id, action: r.action, targetType: r.target_type, targetId: r.target_id, reason: r.reason, outcomeCode: r.outcome_code, createdAt: r.created_at }));
}

