import { ApplicationError } from "../../utils/application-error.js";

export class ReviewError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({
      statusCode,
      code,
      message,
      isOperational: true
    });
    this.name = "ReviewError";
  }
}

export class InvalidReviewIdError extends ReviewError {
  public constructor() {
    super("INVALID_REVIEW_ID", "Review ID must be a positive safe integer.", 400);
    this.name = "InvalidReviewIdError";
  }
}

export class ReviewNotFoundError extends ReviewError {
  public constructor(identifier: string | number) {
    super("REVIEW_NOT_FOUND", `Review '${identifier}' was not found.`, 404);
    this.name = "ReviewNotFoundError";
  }
}

export class ReviewNotEligibleError extends ReviewError {
  public constructor(reason: string) {
    super("REVIEW_NOT_ELIGIBLE", `You are not eligible to review this product: ${reason}`, 403);
    this.name = "ReviewNotEligibleError";
  }
}

export class DuplicateReviewError extends ReviewError {
  public constructor() {
    super("DUPLICATE_REVIEW", "You have already reviewed this product.", 409);
    this.name = "DuplicateReviewError";
  }
}
