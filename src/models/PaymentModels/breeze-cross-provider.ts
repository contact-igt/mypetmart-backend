import { Op, type Transaction } from "sequelize";

import { Cart, BreezeCheckoutSession, Order, Payment } from "../../database/tables/index.js";
import { PaymentError } from "./payment.errors.js";

// Cross-provider duplicate-payment protection.
//
// Scope: one logical purchase = one cart. An unresolved Breeze checkout for a cart
// can still be captured later by Breeze. A PayU or COD payment for the SAME cart
// started meanwhile would therefore purchase the same goods twice. Unrelated
// carts are never affected, and historical PayU/COD orders are untouched.
//
// Concurrency: both sides lock the same Cart row (SELECT ... FOR UPDATE) inside
// their own transaction before checking and writing. Two concurrent starts for one
// cart serialize; the second sees the first's committed state. Each check is a
// read after that lock, so the guard cannot be raced past.
//
// Expiry is never failure: an expired but unresolved Breeze session still blocks.
// Nothing here marks a session failed or released.

export const CROSS_PROVIDER_REASONS = ["BREEZE_ATTEMPT_UNRESOLVED_FOR_CART", "BREEZE_PAYU_ATTEMPT_PENDING"] as const;
export type CrossProviderReason = (typeof CROSS_PROVIDER_REASONS)[number];

const MESSAGES: Record<CrossProviderReason, string> = {
  BREEZE_ATTEMPT_UNRESOLVED_FOR_CART:
    "A Breeze Express checkout for this cart is still being verified. Please wait for it to finish, or contact support, before paying another way.",
  BREEZE_PAYU_ATTEMPT_PENDING:
    "A PayU payment for this cart is still in progress. Please complete it or wait for it to finish before using Express checkout."
};

export class CrossProviderAttemptBlockedError extends PaymentError {
  public constructor(reason: CrossProviderReason) {
    super(reason, MESSAGES[reason], 409, { reason, retryable: true });
    this.name = "CrossProviderAttemptBlockedError";
  }
}

const UNRESOLVED_BREEZE_STATES = ["awaiting_webhook", "order_created", "reconciliation_required"] as const;

/** Row-locks the cart so concurrent Breeze and PayU/COD starts for it serialize. */
export async function lockCartForCheckout(cartId: number, transaction: Transaction): Promise<void> {
  await Cart.findByPk(cartId, { transaction, lock: transaction.LOCK.UPDATE });
}

/**
 * PayU / COD side. Refuses when any unresolved Breeze session exists for this cart.
 * Must be called inside the caller's transaction after lockCartForCheckout().
 */
export async function assertNoUnresolvedBreezeForCart(cartId: number | null, transaction: Transaction): Promise<void> {
  if (cartId === null) return; // legacy order without a cart link: no logical purchase to match
  const unresolved = await BreezeCheckoutSession.count({
    where: { cart_id: cartId, processing_status: { [Op.in]: [...UNRESOLVED_BREEZE_STATES] } },
    transaction
  });
  if (unresolved > 0) throw new CrossProviderAttemptBlockedError("BREEZE_ATTEMPT_UNRESOLVED_FOR_CART");
}

/**
 * Breeze side. Refuses when a PayU payment for this cart is still pending (its
 * order is pending and the attempt has not been reconciled). Must be called inside
 * the Breeze session transaction after lockCartForCheckout().
 */
export async function assertNoPendingPayuForCart(cartId: number, transaction: Transaction): Promise<void> {
  const pending = await Payment.count({
    where: { provider: "payu", status: "pending" },
    include: [{ model: Order, as: "order", where: { cart_id: cartId, status: "pending" }, attributes: [] }],
    transaction
  });
  if (pending > 0) throw new CrossProviderAttemptBlockedError("BREEZE_PAYU_ATTEMPT_PENDING");
}
