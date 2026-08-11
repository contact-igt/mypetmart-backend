import type { CartItemJSON } from "../CartModels/cart.types.js";

export type CheckoutAddressCandidate = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
};

export type InlineAddressInput = {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city: string;
  state: string;
  postalCode: string;
  country?: string;
};

export type CheckoutPreviewInput = {
  savedAddressId?: number;
  shippingAddress?: InlineAddressInput;
  billingSameAsShipping: boolean;
  billingAddress?: InlineAddressInput;
};

export type CheckoutReadiness = {
  cartReady: boolean;
  addressReady: boolean;
  shippingReady: boolean;
  paymentReady: boolean;
  orderReady: boolean;
};

export type CheckoutTotals = {
  merchandiseSubtotal: string;
  shippingAmount: string | null;
  payableTotal: string | null;
};

export type CheckoutPreviewJSON = {
  cart: {
    itemCount: number;
    items: CartItemJSON[];
    merchandiseSubtotal: string;
  };
  shippingAddress: CheckoutAddressCandidate;
  billingSameAsShipping: boolean;
  billingAddress: CheckoutAddressCandidate;
  shipping: {
    status: "pending";
    amount: null;
  };
  totals: CheckoutTotals;
  readiness: CheckoutReadiness;
};
