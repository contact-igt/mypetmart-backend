import type { CartItemJSON } from "../CartModels/cart.types.js";
import type { PaymentMethodConflict } from "../ProductModels/product-payment-methods.js";

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
  // Optional override — when omitted, preview falls back to whatever coupon
  // is already applied on the live Cart (see CheckoutService.preview). Never
  // trusted at face value: always re-evaluated fresh against live cart
  // lines, same as Order creation.
  couponCode?: string;
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
  eligibleMerchandiseSubtotal: string;
  shippingAmount: string | null;
  totalBeforeDiscount: string;
  // Coupon discount only — unchanged meaning. Never includes the Pay Online discount.
  discountAmount: string;
  // Global Pay Online Discount for this preview's payment method ("0.00" for
  // COD, no method, or when disabled). Separate from discountAmount.
  onlinePaymentDiscountAmount: string;
  // merchandiseSubtotal - discountAmount - onlinePaymentDiscountAmount + shippingAmount
  payableTotal: string | null;
};

// Applied Global Pay Online Discount for this preview (null when none applied).
// discountValue is the admin-facing unit: percent for "percentage", rupees for "fixed".
export type CheckoutOnlinePaymentDiscountJSON = {
  discountType: "percentage" | "fixed";
  discountValue: string;
  discountAmount: string;
} | null;

// A server-computed offer to switch payment method. savingAmount is ALWAYS
// currentPayableTotal - payableTotal from two complete authoritative pricings
// (coupon re-evaluated for the other method + Pay Online discount), and the
// offer is only present when that saving is positive and the other method is
// allowed for the cart. The storefront displays these values verbatim.
export type CheckoutPaymentMethodOfferJSON = {
  paymentMethod: CheckoutPaymentMethod;
  savingAmount: string;
  currentPayableTotal: string;
  payableTotal: string;
  couponCode: string | null;
  couponDiscountAmount: string;
  onlinePaymentDiscountAmount: string;
} | null;

// Server-calculated saving when a coupon is ineligible only because of the
// current payment method. The frontend uses this for the "Switch to Prepaid
// and save ₹X" offer — the amount is ALWAYS from the server, never computed
// on the client.
export type CheckoutAlternativeSaving = {
  eligiblePaymentMethod: "payu" | "cod";
  // Amount in paise — use formatPaiseAsMoney on the frontend to display ₹X.XX
  discountAmountPaise: number;
  code: string;
};

// null when no coupon is in effect for this preview (no code on the Cart,
// no couponCode override, or the override was empty). eligible mirrors
// CartCouponJSON's own field — false means the code is currently invalid
// (see message) and totals.discountAmount is "0.00" for this preview.
export type CheckoutCouponJSON = {
  code: string;
  eligible: boolean;
  message: string | null;
  // Only present when the coupon failed SOLELY due to payment method
  // mismatch (reason === "payment_method_ineligible"). Populated from
  // the server coupon engine — never derived by the frontend.
  alternativeSaving?: CheckoutAlternativeSaving;
} | null;

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
  coupon: CheckoutCouponJSON;
  onlinePaymentDiscount: CheckoutOnlinePaymentDiscountJSON;
  // COD selected: what switching to Pay Online would save (null otherwise).
  onlinePaymentOffer: CheckoutPaymentMethodOfferJSON;
  // Pay Online selected: what switching to COD would save (null otherwise).
  cashOnDeliveryOffer: CheckoutPaymentMethodOfferJSON;
  paymentMethod: CheckoutPaymentMethod | null;
  // Authoritative product-level payment availability for the live Cart:
  // the intersection over every item's Product.payment_method_eligibility.
  // The storefront enables payment options from this, never from cached
  // product data. Empty when the Cart has no common method (see conflict).
  allowedPaymentMethods: CheckoutPaymentMethod[];
  paymentMethodConflict: PaymentMethodConflict | null;
  // Customer-facing reason when the requested paymentMethod is not allowed
  // by the Cart's products; null otherwise.
  paymentMethodMessage: string | null;
  serviceability: CheckoutServiceabilityJSON;
  readiness: CheckoutReadiness;
};
