import { ApplicationError } from "../../utils/application-error.js";

export class CartError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super({
      statusCode,
      code,
      message,
      details,
      isOperational: true
    });
    this.name = "CartError";
  }
}

export class InvalidCartItemIdError extends CartError {
  public constructor() {
    super("INVALID_CART_ITEM_ID", "Cart item ID must be a positive safe integer.", 400);
    this.name = "InvalidCartItemIdError";
  }
}

export class CartItemNotFoundError extends CartError {
  public constructor(identifier: string | number) {
    super("CART_ITEM_NOT_FOUND", `Cart item '${identifier}' was not found.`, 404);
    this.name = "CartItemNotFoundError";
  }
}

export class CartVariantRequiredError extends CartError {
  public constructor() {
    super("CART_VARIANT_REQUIRED", "This Product requires selecting a Variant before it can be added to the Cart.", 400);
    this.name = "CartVariantRequiredError";
  }
}

export class CartVariantNotAllowedError extends CartError {
  public constructor() {
    super("CART_VARIANT_NOT_ALLOWED", "This Product does not accept a Variant selection.", 400);
    this.name = "CartVariantNotAllowedError";
  }
}

export class CartVariantMismatchError extends CartError {
  public constructor() {
    super("CART_VARIANT_MISMATCH", "The specified Variant does not belong to the specified Product.", 400);
    this.name = "CartVariantMismatchError";
  }
}

export class CartProductNotAvailableError extends CartError {
  public constructor(reason: string = "Product is not currently available for purchase.") {
    super("CART_PRODUCT_NOT_AVAILABLE", reason, 422);
    this.name = "CartProductNotAvailableError";
  }
}

export class CartVariantNotAvailableError extends CartError {
  public constructor(reason: string = "Variant is not currently available for purchase.") {
    super("CART_VARIANT_NOT_AVAILABLE", reason, 422);
    this.name = "CartVariantNotAvailableError";
  }
}

export class CartInsufficientStockError extends CartError {
  public constructor(availableQuantity: number) {
    super("CART_INSUFFICIENT_STOCK", `Only ${availableQuantity} unit(s) are currently available.`, 422, { availableQuantity });
    this.name = "CartInsufficientStockError";
  }
}

// Distinct from Zod's per-request quantity cap: this fires when a new add COMBINES
// with an existing line to exceed the cap, which depends on DB state Zod cannot see.
export class CartQuantityLimitExceededError extends CartError {
  public constructor(max: number) {
    super("CART_QUANTITY_LIMIT_EXCEEDED", `Cart line quantity cannot exceed ${max} units.`, 422, { max });
    this.name = "CartQuantityLimitExceededError";
  }
}
