import { Op, type Transaction } from "sequelize";

import { BreezeCheckoutSession } from "../../database/tables/index.js";
import type { CartIdentity } from "../CartModels/cart.types.js";
import { PaymentError } from "./payment.errors.js";

// Checkout attempt protection.
//
// A Breeze session may already have captured money even after its launch
// window ("expired") — expiry is NOT evidence of failure, and the webhook bridge
// deliberately accepts late captures. So a NEW session for the same customer (or
// guest) is refused while any earlier attempt is still unresolved. Identity is
// checked across ALL carts, because a customer can open a new cart after an
// attempt was made on an old one.
//
// Blocking states (processing_status):
//   awaiting_webhook         -> BREEZE_ATTEMPT_IN_PROGRESS   (no provider result yet)
//   order_created            -> BREEZE_PAYMENT_VERIFYING     (order exists, payment not finalized)
//   reconciliation_required  -> BREEZE_RECONCILIATION_REQUIRED (needs staff)
// Non-blocking states:
//   finalized  (paid; the cart is ordered and a new purchase is legitimate)
//   failed     (provider reported FAILED, a documented terminal state)
//   released   (an admin confirmed, audited, that no capture will occur)
//
// Nothing here times out an attempt. A blocked customer is unblocked only by a
// webhook result or by the audited admin release (see breeze-reconciliation.service.ts).

export const BREEZE_BLOCKING_REASONS = ["BREEZE_ATTEMPT_IN_PROGRESS", "BREEZE_PAYMENT_VERIFYING", "BREEZE_RECONCILIATION_REQUIRED"] as const;
export type BreezeBlockingReason = (typeof BREEZE_BLOCKING_REASONS)[number];

const MESSAGES: Record<BreezeBlockingReason, string> = {
  BREEZE_ATTEMPT_IN_PROGRESS:
    "A previous Express checkout is still open and may already have been paid. Please wait, or contact support before starting another checkout.",
  BREEZE_PAYMENT_VERIFYING:
    "Your payment is being verified. Please don't make another payment yet.",
  BREEZE_RECONCILIATION_REQUIRED:
    "A previous Express checkout needs a manual check before you can start another. Please contact support."
};

const SEVERITY: Record<BreezeBlockingReason, number> = {
  BREEZE_RECONCILIATION_REQUIRED: 3,
  BREEZE_PAYMENT_VERIFYING: 2,
  BREEZE_ATTEMPT_IN_PROGRESS: 1
};

const STATUS_TO_REASON: Record<string, BreezeBlockingReason> = {
  awaiting_webhook: "BREEZE_ATTEMPT_IN_PROGRESS",
  order_created: "BREEZE_PAYMENT_VERIFYING",
  reconciliation_required: "BREEZE_RECONCILIATION_REQUIRED"
};

export class BreezeAttemptBlockedError extends PaymentError {
  public constructor(reason: BreezeBlockingReason) {
    super(reason, MESSAGES[reason], 409, { reason, retryable: reason === "BREEZE_PAYMENT_VERIFYING" });
    this.name = "BreezeAttemptBlockedError";
  }
}

function identityWhere(identity: CartIdentity) {
  return identity.type === "customer" ? { user_id: identity.userId } : { user_id: null, guest_identity_hash: identity.tokenHash };
}

/** The most severe unresolved attempt for this identity, or null when a new checkout is safe. */
export async function findBlockingAttempt(identity: CartIdentity, transaction?: Transaction): Promise<BreezeBlockingReason | null> {
  const unresolved = await BreezeCheckoutSession.findAll({
    ...(transaction ? { transaction } : {}),
    attributes: ["processing_status"],
    where: {
      ...identityWhere(identity),
      processing_status: { [Op.in]: Object.keys(STATUS_TO_REASON) }
    }
  });
  let worst: BreezeBlockingReason | null = null;
  for (const row of unresolved) {
    const reason = STATUS_TO_REASON[row.processing_status];
    if (reason && (worst === null || SEVERITY[reason] > SEVERITY[worst])) worst = reason;
  }
  return worst;
}

/** Throws BreezeAttemptBlockedError (409, machine-readable reason) when a new checkout is unsafe. */
export async function assertNoBlockingAttempt(identity: CartIdentity, transaction?: Transaction): Promise<void> {
  const reason = await findBlockingAttempt(identity, transaction);
  if (reason) throw new BreezeAttemptBlockedError(reason);
}
