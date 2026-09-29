import type { CouponDiscountType } from "../../constants/database.constants.js";
import type { CheckoutPaymentMethod } from "./checkout.types.js";

// Global Pay Online Discount — one store-wide rule, separate from coupons.
// A coupon is evaluated first (by the untouched coupon engine); this discount
// then applies to whatever merchandise remains, only for prepaid payment.
//
// discountValue follows the coupon convention for the same discountType:
// "percentage" in basis points (10% = 1000), "fixed" in paise (₹100 = 10000).
export type OnlinePaymentDiscountType = CouponDiscountType;

export type OnlinePaymentDiscountConfig = {
  enabled: boolean;
  discountType: OnlinePaymentDiscountType;
  discountValue: number;
};

export const DISABLED_ONLINE_PAYMENT_DISCOUNT: OnlinePaymentDiscountConfig = {
  enabled: false,
  discountType: "percentage",
  discountValue: 0
};

export const MAX_ONLINE_DISCOUNT_BASIS_POINTS = 10_000;

/**
 * Canonical prepaid classification. "payu" is the storefront's single
 * Pay Online method — the Breeze gateway is also initiated under "payu"
 * (see PaymentService.initiateBreezeCheckout), so it is covered here too.
 */
export function isPrepaidPaymentMethod(method: CheckoutPaymentMethod | undefined | null): boolean {
  return method === "payu";
}

/**
 * The one place the Global Pay Online Discount is calculated — checkout
 * preview and Order creation both call this, so they can never disagree.
 * Integer paise in, integer paise out; never exceeds the eligible amount.
 */
export function calculateGlobalOnlinePaymentDiscount(input: {
  eligibleMerchandisePaise: number;
  paymentMethod: CheckoutPaymentMethod | undefined | null;
  configuration: OnlinePaymentDiscountConfig;
}): { discountAmountPaise: number } {
  const { eligibleMerchandisePaise, paymentMethod, configuration } = input;
  if (!configuration.enabled || !isPrepaidPaymentMethod(paymentMethod) || eligibleMerchandisePaise <= 0 || configuration.discountValue <= 0) {
    return { discountAmountPaise: 0 };
  }

  const discountPaise =
    configuration.discountType === "percentage"
      ? Math.floor((eligibleMerchandisePaise * Math.min(configuration.discountValue, MAX_ONLINE_DISCOUNT_BASIS_POINTS)) / 10_000)
      : configuration.discountValue;

  return { discountAmountPaise: Math.max(0, Math.min(discountPaise, eligibleMerchandisePaise)) };
}

/**
 * Splits the online discount across Order lines in proportion to each line's
 * remaining (post-coupon) amount, for order_items.online_payment_discount_allocated_paise.
 * Deterministic: floored shares, then any leftover paise go one at a time to
 * lines with headroom starting from the LAST line — the same "remainder to the
 * last line" principle as CouponPricingService.allocateDiscountAcrossLines,
 * but never allocating more than a line's own remaining amount. The result
 * always sums exactly to totalDiscountPaise (which callers cap at the sum of
 * netLinePaise).
 */
export function allocateOnlinePaymentDiscountAcrossLines(netLinePaise: number[], totalDiscountPaise: number): number[] {
  const allocations = new Array<number>(netLinePaise.length).fill(0);
  const netTotal = netLinePaise.reduce((sum, value) => sum + Math.max(0, value), 0);
  const target = Math.min(Math.max(0, totalDiscountPaise), netTotal);
  if (target === 0) {
    return allocations;
  }

  let allocated = 0;
  netLinePaise.forEach((net, index) => {
    const share = net > 0 ? Math.floor((target * net) / netTotal) : 0;
    allocations[index] = share;
    allocated += share;
  });

  let remainder = target - allocated;
  for (let index = netLinePaise.length - 1; index >= 0 && remainder > 0; index--) {
    const headroom = Math.max(0, netLinePaise[index]!) - allocations[index]!;
    const extra = Math.min(headroom, remainder);
    allocations[index]! += extra;
    remainder -= extra;
  }

  return allocations;
}
