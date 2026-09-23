import type { CartStatus } from "../../constants/database.constants.js";

export type CartAvailabilityReason = "OUT_OF_STOCK" | "PRODUCT_UNAVAILABLE" | "VARIANT_UNAVAILABLE";

export type CartItemImageJSON = {
  url: string;
  alt: string | null;
};

export type CartItemJSON = {
  cartItemId: number;
  productId: number;
  categoryId: number;
  variantId: number | null;
  productName: string;
  productSlug: string;
  productType: "simple" | "variant";
  sku: string;
  variantName: string | null;
  image: CartItemImageJSON | null;
  price: string;
  compareAtPrice: string | null;
  quantity: number;
  subtotal: string;
  available: boolean;
  availabilityReason: CartAvailabilityReason | null;
  availableQuantity: number;
};

// null only when the Cart has no coupon_id at all (nothing ever applied).
// When a coupon IS applied, `eligible` distinguishes "currently contributing
// a discount" from "applied but not currently valid" (e.g. cart total
// dropped below the coupon's minimum after an item was removed) — the
// applied reference is deliberately left on the Cart in that case so it
// resumes working automatically if the cart becomes eligible again, rather
// than silently vanishing. `message` explains why when `eligible` is false;
// always null when eligible is true.
export type CartCouponJSON = {
  code: string;
  eligible: boolean;
  discountAmount: string;
  eligibleMerchandiseSubtotal: string;
  message: string | null;
} | null;

export type CartJSON = {
  id: number | null;
  status: CartStatus;
  itemCount: number;
  subtotal: string;
  items: CartItemJSON[];
  coupon: CartCouponJSON;
};

export type ApplyCartCouponInput = {
  code: string;
};

export type AddCartItemInput = {
  productId: number;
  variantId?: number;
  quantity: number;
};

export type UpdateCartItemInput = {
  quantity: number;
};

export type CartMergeLineReport = {
  productId: number;
  variantId: number | null;
  requestedQuantity: number;
  finalQuantity: number;
};

export type CartMergeReport = {
  mergedItems: CartMergeLineReport[];
  adjustedItems: CartMergeLineReport[];
  skippedItems: Array<{ productId: number; variantId: number | null; requestedQuantity: number }>;
};

export type CartMergeResult = {
  cart: CartJSON;
  mergeReport: CartMergeReport;
};

export type CartIdentity = { type: "customer"; userId: number } | { type: "guest"; tokenHash: string };
