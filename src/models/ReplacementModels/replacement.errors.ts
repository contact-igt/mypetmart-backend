import { ApplicationError } from "../../utils/application-error.js";

export class ReplacementError extends ApplicationError {
  public constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super({ statusCode, code, message, details, isOperational: true });
    this.name = "ReplacementError";
  }
}

export class ReplacementResolutionMismatchError extends ReplacementError {
  public constructor() {
    super("REPLACEMENT_RESOLUTION_MISMATCH", "This return request selected a refund, not a replacement.", 422);
  }
}

export class ReplacementCatalogUnavailableError extends ReplacementError {
  public constructor() {
    super("REPLACEMENT_CATALOG_UNAVAILABLE", "The original product or variant no longer exists and cannot be replaced.", 422);
  }
}

export class ReplacementNotFoundError extends ReplacementError {
  public constructor(returnRequestId: number) {
    super("REPLACEMENT_NOT_FOUND", `Return request '${returnRequestId}' has no replacement record.`, 404);
  }
}

export class ReplacementStockUnavailableError extends ReplacementError {
  public constructor() {
    super("REPLACEMENT_STOCK_UNAVAILABLE", "Replacement stock is still unavailable.", 409);
  }
}

export class ReplacementInvalidStatusTransitionError extends ReplacementError {
  public constructor(current: string, next: string) {
    super("REPLACEMENT_INVALID_STATUS_TRANSITION", `Replacement cannot move from '${current}' to '${next}'.`, 409, { current, next });
  }
}
