import type { StorefrontProductListItemJSON } from "../ProductModels/product.types.js";

export type WishlistProductSummaryJSON = StorefrontProductListItemJSON & {
  available: boolean;
};

export type WishlistItemJSON = {
  wishlistItemId: number;
  createdAt: string;
  product: WishlistProductSummaryJSON;
};

export type WishlistJSON = {
  items: WishlistItemJSON[];
};

export type AddWishlistItemInput = {
  productId: number;
};

export type AddWishlistItemResult = {
  wishlist: WishlistJSON;
  created: boolean;
};
