import type { CartItemJSON } from "../CartModels/cart.types.js";

export const CHECKOUT_PAYMENT_METHOD_VALUES = ["payu", "cod"] as const;
export type CheckoutPaymentMethod = (typeof CHECKOUT_PAYMENT_METHOD_VALUES)[number];

export type CheckoutAddressCandidate = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  // Coordinates are optional (both or neither). Exposed as number|null.
  latitude: number | null;
  longitude: number | null;
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
  // Both must be present together or both absent. Never one without the other.
  latitude?: number;
  longitude?: number;
};

export type CheckoutPreviewInput = {
  savedAddressId?: number;
  shippingAddress?: InlineAddressInput;
  billingSameAsShipping: boolean;
  billingAddress?: InlineAddressInput;
  contactEmail?: string;
  // Optional for backwards compatibility with the existing one-step client.
  // Stage 2 will send this explicitly before Order creation.
  paymentMethod?: CheckoutPaymentMethod;
};

export type CheckoutServiceabilityJSON = {
  paymentMode: "prepaid" | "cod";
  serviceable: boolean;
} | null;

export type CheckoutReadiness = {
  cartReady: boolean;
  addressReady: boolean;
  shippingReady: boolean;
  paymentReady: boolean;
  orderReady: boolean;
  serviceable: boolean;
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
    amount: string | null;
  };
  totals: CheckoutTotals;
  paymentMethod: CheckoutPaymentMethod | null;
  serviceability: CheckoutServiceabilityJSON;
  readiness: CheckoutReadiness;
};
