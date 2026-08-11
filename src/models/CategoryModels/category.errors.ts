import { ApplicationError } from "../../utils/application-error.js";

export class CategoryError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({
      statusCode,
      code,
      message,
      isOperational: true
    });
    this.name = "CategoryError";
  }
}

export class CategoryNotFoundError extends CategoryError {
  public constructor() {
    super("CATEGORY_NOT_FOUND", "Category not found.", 404);
    this.name = "CategoryNotFoundError";
  }
}

export class CategorySlugConflictError extends CategoryError {
  public constructor(slug?: string) {
    super(
      "CATEGORY_SLUG_CONFLICT",
      slug ? `Category slug '${slug}' is already in use.` : "Category slug is already in use.",
      409
    );
    this.name = "CategorySlugConflictError";
  }
}

export class CategoryDeleteBlockedError extends CategoryError {
  public constructor(message: string = "Cannot delete category with associated products.") {
    super("CATEGORY_DELETE_BLOCKED", message, 422);
    this.name = "CategoryDeleteBlockedError";
  }
}

export class CategoryNotDeletedError extends CategoryError {
  public constructor() {
    super("CATEGORY_NOT_DELETED", "Category is not deleted.", 409);
    this.name = "CategoryNotDeletedError";
  }
}

export class CategoryRestoreConflictError extends CategoryError {
  public constructor(slug?: string) {
    super(
      "CATEGORY_RESTORE_CONFLICT",
      slug
        ? `Category slug '${slug}' conflicts with another category and cannot be restored.`
        : "Category cannot be restored because its slug conflicts with another category.",
      409
    );
    this.name = "CategoryRestoreConflictError";
  }
}

export class InvalidCategoryIdError extends CategoryError {
  public constructor() {
    super("INVALID_CATEGORY_ID", "Category ID must be a positive integer.", 400);
    this.name = "InvalidCategoryIdError";
  }
}

export class InvalidCategoryDataError extends CategoryError {
  public constructor(message: string = "Invalid category data.") {
    super("INVALID_CATEGORY_DATA", message, 400);
    this.name = "InvalidCategoryDataError";
  }
}
