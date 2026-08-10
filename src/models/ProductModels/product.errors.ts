import { ApplicationError } from "../../utils/application-error.js";

export class ProductError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({
      statusCode,
      code,
      message,
      isOperational: true
    });
    this.name = "ProductError";
  }
}

export class ProductNotFoundError extends ProductError {
  public constructor(identifier: string | number) {
    super("PRODUCT_NOT_FOUND", `Product '${identifier}' was not found.`, 404);
    this.name = "ProductNotFoundError";
  }
}

export class InvalidProductIdError extends ProductError {
  public constructor() {
    super("INVALID_PRODUCT_ID", "Product ID must be a positive safe integer.", 400);
    this.name = "InvalidProductIdError";
  }
}

export class InvalidVariantIdError extends ProductError {
  public constructor() {
    super("INVALID_VARIANT_ID", "Variant ID must be a positive safe integer.", 400);
    this.name = "InvalidVariantIdError";
  }
}

export class InvalidImageIdError extends ProductError {
  public constructor() {
    super("INVALID_IMAGE_ID", "Image ID must be a positive safe integer.", 400);
    this.name = "InvalidImageIdError";
  }
}

export class ProductSlugConflictError extends ProductError {
  public constructor(slug: string) {
    super("PRODUCT_SLUG_CONFLICT", `Product slug '${slug}' is already taken.`, 409);
    this.name = "ProductSlugConflictError";
  }
}

export class ProductSkuConflictError extends ProductError {
  public constructor(sku: string) {
    super("PRODUCT_SKU_CONFLICT", `SKU '${sku}' is already reserved or in use across the catalog.`, 409);
    this.name = "ProductSkuConflictError";
  }
}

export class ProductCategoryInvalidError extends ProductError {
  public constructor(reason: string) {
    super("PRODUCT_CATEGORY_INVALID", reason, 422);
    this.name = "ProductCategoryInvalidError";
  }
}

export class ProductShippingDataInvalidError extends ProductError {
  public constructor(reason: string) {
    super("PRODUCT_NOT_SHIPPING_READY", reason, 422);
    this.name = "ProductShippingDataInvalidError";
  }
}

export class ProductNotSellableError extends ProductError {
  public constructor(reason: string) {
    super("PRODUCT_NOT_SELLABLE", reason, 422);
    this.name = "ProductNotSellableError";
  }
}

export class ProductVariantNotFoundError extends ProductError {
  public constructor(variantId: number) {
    super("PRODUCT_VARIANT_NOT_FOUND", `Product variant '${variantId}' was not found.`, 404);
    this.name = "ProductVariantNotFoundError";
  }
}

export class ProductVariantSkuConflictError extends ProductError {
  public constructor(sku: string) {
    super("PRODUCT_VARIANT_SKU_CONFLICT", `Variant SKU '${sku}' is already reserved or in use across the catalog.`, 409);
    this.name = "ProductVariantSkuConflictError";
  }
}

export class LastActiveVariantError extends ProductError {
  public constructor() {
    super("LAST_ACTIVE_VARIANT_PROTECTION", "Cannot deactivate or delete the final active variant of an active product. Deactivate or archive the product first.", 422);
    this.name = "LastActiveVariantError";
  }
}

export class ProductImageNotFoundError extends ProductError {
  public constructor(imageId: number) {
    super("PRODUCT_IMAGE_NOT_FOUND", `Product image '${imageId}' was not found.`, 404);
    this.name = "ProductImageNotFoundError";
  }
}

export class InvalidProductDataError extends ProductError {
  public constructor(message: string) {
    super("INVALID_PRODUCT_DATA", message, 400);
    this.name = "InvalidProductDataError";
  }
}
