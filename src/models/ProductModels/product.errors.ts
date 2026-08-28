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

export class ProductNotDeletedError extends ProductError {
  public constructor(productId: number) {
    super("PRODUCT_NOT_DELETED", `Product '${productId}' is not deleted.`, 409);
    this.name = "ProductNotDeletedError";
  }
}

export class ProductLegacyTrashNotRestorableError extends ProductError {
  public constructor(productId: number) {
    super(
      "PRODUCT_LEGACY_TRASH_NOT_RESTORABLE",
      `Product '${productId}' was deleted using the previous deletion workflow and cannot be restored safely because its Variants, images, or R2 objects may no longer be recoverable.`,
      409
    );
    this.name = "ProductLegacyTrashNotRestorableError";
  }
}

export class ProductRestoreSkuConflictError extends ProductError {
  public constructor(sku: string) {
    super("PRODUCT_RESTORE_SKU_CONFLICT", `Historical SKU reservation ownership for '${sku}' is invalid.`, 409);
    this.name = "ProductRestoreSkuConflictError";
  }
}

export class ProductRestoreSlugConflictError extends ProductError {
  public constructor(slug: string) {
    super("PRODUCT_RESTORE_SLUG_CONFLICT", `Historical Product slug '${slug}' conflicts with another Product.`, 409);
    this.name = "ProductRestoreSlugConflictError";
  }
}

export class ProductRestoreConflictError extends ProductError {
  public constructor(reason: string) {
    super("PRODUCT_RESTORE_CONFLICT", reason, 409);
    this.name = "ProductRestoreConflictError";
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

export class InvalidFeatureIdError extends ProductError {
  public constructor() {
    super("INVALID_FEATURE_ID", "Feature ID must be a positive safe integer.", 400);
    this.name = "InvalidFeatureIdError";
  }
}

export class ProductFeatureNotFoundError extends ProductError {
  public constructor(featureId: number) {
    super("PRODUCT_FEATURE_NOT_FOUND", `Product feature '${featureId}' was not found.`, 404);
    this.name = "ProductFeatureNotFoundError";
  }
}

export class InvalidFaqIdError extends ProductError {
  public constructor() {
    super("INVALID_FAQ_ID", "FAQ ID must be a positive safe integer.", 400);
    this.name = "InvalidFaqIdError";
  }
}

export class ProductFaqNotFoundError extends ProductError {
  public constructor(faqId: number) {
    super("PRODUCT_FAQ_NOT_FOUND", `Product FAQ '${faqId}' was not found.`, 404);
    this.name = "ProductFaqNotFoundError";
  }
}

export class ProductImageMediaTypeNotAllowedError extends ProductError {
  public constructor() {
    super("PRODUCT_IMAGE_MEDIA_TYPE_NOT_ALLOWED", "Only image Media Assets can be attached as a Product image. This asset is a video.", 422);
    this.name = "ProductImageMediaTypeNotAllowedError";
  }
}

export class InvalidMediaAssignmentIdError extends ProductError {
  public constructor() {
    super("INVALID_MEDIA_ASSIGNMENT_ID", "Media assignment ID must be a positive safe integer.", 400);
    this.name = "InvalidMediaAssignmentIdError";
  }
}

export class ProductMediaAssignmentNotFoundError extends ProductError {
  public constructor(assignmentId: number) {
    super("PRODUCT_MEDIA_ASSIGNMENT_NOT_FOUND", `Product media assignment '${assignmentId}' was not found.`, 404);
    this.name = "ProductMediaAssignmentNotFoundError";
  }
}

export class ProductMediaAssignmentTypeNotAllowedError extends ProductError {
  public constructor() {
    super("PRODUCT_MEDIA_ASSIGNMENT_TYPE_NOT_ALLOWED", "Only video Media Assets can be assigned as a Product video or Testimonial video.", 422);
    this.name = "ProductMediaAssignmentTypeNotAllowedError";
  }
}

export class InvalidSpecificationIdError extends ProductError {
  public constructor() {
    super("INVALID_SPECIFICATION_ID", "Specification ID must be a positive safe integer.", 400);
    this.name = "InvalidSpecificationIdError";
  }
}

export class ProductSpecificationNotFoundError extends ProductError {
  public constructor(specificationId: number) {
    super("PRODUCT_SPECIFICATION_NOT_FOUND", `Product specification '${specificationId}' was not found.`, 404);
    this.name = "ProductSpecificationNotFoundError";
  }
}

export class DuplicateSpecificationLabelError extends ProductError {
  public constructor(label: string) {
    super("DUPLICATE_SPECIFICATION_LABEL", `A specification labeled '${label}' already exists on this Product.`, 409);
    this.name = "DuplicateSpecificationLabelError";
  }
}

export class ReservedSpecificationLabelError extends ProductError {
  public constructor(label: string) {
    super(
      "RESERVED_SPECIFICATION_LABEL",
      `'${label}' is already managed by the Product's own SKU, price, MRP, or stock fields and cannot be used as a custom specification label.`,
      422
    );
    this.name = "ReservedSpecificationLabelError";
  }
}

export class InvalidContentBlockIdError extends ProductError {
  public constructor() {
    super("INVALID_CONTENT_BLOCK_ID", "Content block ID must be a positive safe integer.", 400);
    this.name = "InvalidContentBlockIdError";
  }
}

export class ProductContentBlockNotFoundError extends ProductError {
  public constructor(blockId: number) {
    super("PRODUCT_CONTENT_BLOCK_NOT_FOUND", `Product content block '${blockId}' was not found.`, 404);
    this.name = "ProductContentBlockNotFoundError";
  }
}

export class EmptyContentBlockError extends ProductError {
  public constructor() {
    super("EMPTY_CONTENT_BLOCK", "A content block needs at least one of: media, heading, or description.", 422);
    this.name = "EmptyContentBlockError";
  }
}

export class InvalidProductDataError extends ProductError {
  public constructor(message: string) {
    super("INVALID_PRODUCT_DATA", message, 400);
    this.name = "InvalidProductDataError";
  }
}
