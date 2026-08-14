import { ApplicationError } from "../../utils/application-error.js";

export class WishlistError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super({
      statusCode,
      code,
      message,
      details,
      isOperational: true
    });
    this.name = "WishlistError";
  }
}

export class InvalidWishlistProductIdError extends WishlistError {
  public constructor() {
    super("INVALID_WISHLIST_PRODUCT_ID", "Product ID must be a positive safe integer.", 400);
    this.name = "InvalidWishlistProductIdError";
  }
}

export class WishlistItemNotFoundError extends WishlistError {
  public constructor(productId: number) {
    super("WISHLIST_ITEM_NOT_FOUND", `Product '${productId}' was not found in this Wishlist.`, 404);
    this.name = "WishlistItemNotFoundError";
  }
}
