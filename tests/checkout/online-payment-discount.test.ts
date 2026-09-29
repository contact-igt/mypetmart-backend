import { describe, expect, it } from "vitest";
import { allocateOnlinePaymentDiscountAcrossLines, calculateGlobalOnlinePaymentDiscount } from "../../src/models/CheckoutModels/online-payment-discount.js";

describe("Global Pay Online discount", () => {
  const percent = { enabled: true, discountType: "percentage" as const, discountValue: 1000 };

  it("applies only to Pay Online and caps a fixed discount at remaining merchandise", () => {
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 10_000, paymentMethod: "payu", configuration: percent }).discountAmountPaise).toBe(1000);
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 10_000, paymentMethod: "cod", configuration: percent }).discountAmountPaise).toBe(0);
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 4_500, paymentMethod: "payu", configuration: { enabled: true, discountType: "fixed", discountValue: 10_000 } }).discountAmountPaise).toBe(4500);
  });

  it("allocates every paise without exceeding a post-coupon line amount", () => {
    const allocation = allocateOnlinePaymentDiscountAcrossLines([101, 100, 0], 101);
    expect(allocation).toEqual([50, 51, 0]);
    expect(allocation.reduce((sum, amount) => sum + amount, 0)).toBe(101);
  });
});
