import type { CartStatus } from "../../constants/database.constants.js";

export type CartAvailabilityReason = "OUT_OF_STOCK" | "PRODUCT_UNAVAILABLE" | "VARIANT_UNAVAILABLE";

export type CartItemImageJSON = {
  url: string;
  alt: string | null;
};

export type CartItemJSON = {
  cartItemId: number;
  productId: number;
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

export type CartJSON = {
  id: number | null;
  status: CartStatus;
  itemCount: number;
  subtotal: string;
  items: CartItemJSON[];
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
