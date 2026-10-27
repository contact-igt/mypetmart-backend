import type { ProductPaymentMethodEligibility } from "../../constants/database.constants.js";

// The immutable, server-authoritative order lines captured at the moment a
// Breeze cart is signed. The Order Create Webhook builds the MyPetMart Order
// ONLY from this snapshot — never from the live cart (which the customer may
// have changed) and never from Breeze-returned product prices.
//
// V1 scope: no coupon, no Pay Online discount, free shipping (the session API
// rejects coupon carts), so totalPaise === subtotalPaise + shippingFeePaise.
export type BreezeOrderIntentLine = {
  productId: number;
  categoryId: number;
  variantId: number | null;
  productName: string;
  productSku: string;
  variantName: string | null;
  variantSku: string | null;
  productImage: string | null;
  quantity: number;
  unitPricePaise: number;
  paymentMethodEligibility: ProductPaymentMethodEligibility;
};

export type BreezeOrderIntent = {
  version: 1;
  lines: BreezeOrderIntentLine[];
  subtotalPaise: number;
  shippingFeePaise: number;
  totalPaise: number;
  currency: "INR";
};
