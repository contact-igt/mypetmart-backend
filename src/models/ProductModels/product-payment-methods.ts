import type { Transaction } from "sequelize";

import type { ProductPaymentMethodEligibility } from "../../constants/database.constants.js";
import { Product } from "../../database/tables/index.js";

// Single source of truth for product-level payment-method availability.
// Checkout Preview, Order creation and the payment entry points all resolve
// through here, always from persisted rows (live Product rows before an Order
// exists, the immutable OrderItem snapshot afterwards) — never from anything
// the browser sends.

export type PaymentMethod = "payu" | "cod";
export const ALL_PAYMENT_METHODS: readonly PaymentMethod[] = ["payu", "cod"];

export const PAYMENT_METHOD_MESSAGES = {
  payuOnly: "Cash on Delivery is not available for one or more items in your cart. Please pay online to continue.",
  codOnly: "Online payment is not available for one or more items in your cart. Please choose Cash on Delivery.",
  conflict: "Some items in your cart require different payment methods. Please purchase them separately."
} as const;

export type PaymentMethodLine = {
  productId: number;
  productName: string;
  eligibility: ProductPaymentMethodEligibility;
};

export type PaymentMethodConflict = {
  code: "PAYMENT_METHOD_CONFLICT";
  message: string;
  incompatibleItems: Array<{ productId: number; productName: string; paymentMethodEligibility: ProductPaymentMethodEligibility }>;
};

export type CartPaymentMethodResolution = {
  allowedPaymentMethods: PaymentMethod[];
  conflict: PaymentMethodConflict | null;
};

export function methodsAllowedBy(eligibility: ProductPaymentMethodEligibility): PaymentMethod[] {
  return eligibility === "both" ? [...ALL_PAYMENT_METHODS] : [eligibility];
}

/** Allowed methods = intersection of every line's allowed methods. */
export function resolveCartPaymentMethods(lines: PaymentMethodLine[]): CartPaymentMethodResolution {
  const allowedPaymentMethods = ALL_PAYMENT_METHODS.filter((method) => lines.every((line) => methodsAllowedBy(line.eligibility).includes(method)));
  if (allowedPaymentMethods.length > 0 || lines.length === 0) {
    return { allowedPaymentMethods, conflict: null };
  }
  // No common method: every restricted line contributes to the conflict.
  const seen = new Set<number>();
  const incompatibleItems = lines
    .filter((line) => line.eligibility !== "both" && !seen.has(line.productId) && seen.add(line.productId))
    .map((line) => ({ productId: line.productId, productName: line.productName, paymentMethodEligibility: line.eligibility }));
  return { allowedPaymentMethods, conflict: { code: "PAYMENT_METHOD_CONFLICT", message: PAYMENT_METHOD_MESSAGES.conflict, incompatibleItems } };
}

/** Why a method is unavailable, in customer-facing words. */
export function unavailableMethodMessage(method: PaymentMethod): string {
  return method === "cod" ? PAYMENT_METHOD_MESSAGES.payuOnly : PAYMENT_METHOD_MESSAGES.codOnly;
}

/** Loads the authoritative eligibility for the given Products from the database. */
export async function loadProductPaymentMethodLines(productIds: number[], transaction?: Transaction): Promise<PaymentMethodLine[]> {
  if (productIds.length === 0) return [];
  const products = await Product.findAll({
    where: { id: [...new Set(productIds)] },
    attributes: ["id", "name", "payment_method_eligibility"],
    ...(transaction ? { transaction } : {})
  });
  const byId = new Map(products.map((product) => [product.id, product]));
  return productIds.flatMap((productId) => {
    const product = byId.get(productId);
    return product ? [{ productId, productName: product.name, eligibility: product.payment_method_eligibility ?? "both" }] : [];
  });
}
