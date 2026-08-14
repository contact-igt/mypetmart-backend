import type { OrderStatus } from "../../constants/database.constants.js";

/**
 * Backend-authoritative Order status graph. This is a fresh implementation of
 * the same graph already prototyped (frontend-only, non-authoritative) in
 * admin/src/data/admin/order-status-rules.ts — preserved intentionally, not
 * reinvented: forward-only pending->confirmed->processing->shipped->delivered,
 * cancellable from any non-terminal state, delivered->return_requested only,
 * cancelled/return_requested are terminal. Order/payment/fulfilment status are
 * independent state machines; this graph only ever governs `orders.status`.
 */
const FORWARD_SEQUENCE: readonly Exclude<OrderStatus, "cancelled" | "return_requested">[] = [
  "pending",
  "confirmed",
  "processing",
  "shipped",
  "delivered"
];

export function getValidNextOrderStatuses(current: OrderStatus): OrderStatus[] {
  if (current === "cancelled" || current === "return_requested") {
    return [];
  }
  if (current === "delivered") {
    return ["return_requested"];
  }
  const rank = FORWARD_SEQUENCE.indexOf(current);
  const forward = FORWARD_SEQUENCE.filter((_, index) => index > rank) as OrderStatus[];
  return [...forward, "cancelled"];
}

export function isValidOrderStatusTransition(current: OrderStatus, next: OrderStatus): boolean {
  return getValidNextOrderStatuses(current).includes(next);
}
