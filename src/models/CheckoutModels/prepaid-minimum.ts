import { ApplicationError } from "../../utils/application-error.js";
import { formatPaiseAsMoney } from "../../utils/product-money.js";
import { isPrepaidPaymentMethod } from "./online-payment-discount.js";
import type { CheckoutPaymentMethod } from "./checkout.types.js";

// Final prepaid payment safety floor: an online (PayU/Breeze) payment is
// never created for an Order.total below ₹1.00, whatever the reason (coupon,
// sub-₹1 product, …). Checked against the FINAL total including shipping —
// the amount the provider would actually charge.
//
// Deliberately separate from MIN_ONLINE_PAYABLE_MERCHANDISE_PAISE
// (online-payment-discount.ts), which only stops the Pay Online discount
// itself from making merchandise free. This rule never changes any amount:
// it only rejects. Payment.amount always stays exactly Order.total.
export const MIN_PREPAID_PAYABLE_PAISE = 100;

export const PREPAID_MINIMUM_PAYABLE_MESSAGE = "Online payment requires a minimum payable amount of ₹1.00.";

export function meetsPrepaidMinimum(totalPaise: number): boolean {
  return totalPaise >= MIN_PREPAID_PAYABLE_PAISE;
}

/** True when this method is prepaid and the final total is below the floor. */
export function isBelowPrepaidMinimum(paymentMethod: CheckoutPaymentMethod | undefined | null, totalPaise: number): boolean {
  return isPrepaidPaymentMethod(paymentMethod) && !meetsPrepaidMinimum(totalPaise);
}

export class PrepaidMinimumPayableError extends ApplicationError {
  public constructor(actualPayablePaise: number) {
    super({
      statusCode: 422,
      code: "PREPAID_MINIMUM_PAYABLE_NOT_MET",
      message: PREPAID_MINIMUM_PAYABLE_MESSAGE,
      details: {
        minimumPayable: formatPaiseAsMoney(MIN_PREPAID_PAYABLE_PAISE),
        actualPayable: formatPaiseAsMoney(Math.max(0, actualPayablePaise))
      },
      isOperational: true
    });
    this.name = "PrepaidMinimumPayableError";
  }
}
