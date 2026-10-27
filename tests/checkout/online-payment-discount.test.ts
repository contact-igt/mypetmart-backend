import { describe, expect, it } from "vitest";
import { allocateOnlinePaymentDiscountAcrossLines, calculateGlobalOnlinePaymentDiscount } from "../../src/models/CheckoutModels/online-payment-discount.js";

describe("Global Pay Online discount", () => {
  const percent = { enabled: true, discountType: "percentage" as const, discountValue: 1000 };

  const fixed100 = { enabled: true, discountType: "fixed" as const, discountValue: 10_000 };

  it("applies only to Pay Online and caps a fixed discount so ₹1.00 of merchandise remains payable", () => {
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 10_000, paymentMethod: "payu", configuration: percent }).discountAmountPaise).toBe(1000);
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 10_000, paymentMethod: "cod", configuration: percent }).discountAmountPaise).toBe(0);
    // ₹45 left after coupon, ₹100 fixed → ₹44 off, ₹1.00 still payable.
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 4_500, paymentMethod: "payu", configuration: fixed100 }).discountAmountPaise).toBe(4400);
    // ₹1,000 with ₹100 fixed is unaffected by the floor.
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 100_000, paymentMethod: "payu", configuration: fixed100 }).discountAmountPaise).toBe(10_000);
  });

  it("never makes an online order free: a ₹1 cart gets no Pay Online discount", () => {
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 100, paymentMethod: "payu", configuration: fixed100 }).discountAmountPaise).toBe(0);
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 50, paymentMethod: "payu", configuration: fixed100 }).discountAmountPaise).toBe(0);
    // 100% percentage also leaves ₹1.00.
    const full = { enabled: true, discountType: "percentage" as const, discountValue: 10_000 };
    expect(calculateGlobalOnlinePaymentDiscount({ eligibleMerchandisePaise: 49_900, paymentMethod: "payu", configuration: full }).discountAmountPaise).toBe(49_800);
  });

  it("allocates every paise without exceeding a post-coupon line amount", () => {
    const allocation = allocateOnlinePaymentDiscountAcrossLines([101, 100, 0], 101);
    expect(allocation).toEqual([50, 51, 0]);
    expect(allocation.reduce((sum, amount) => sum + amount, 0)).toBe(101);
  });
});
