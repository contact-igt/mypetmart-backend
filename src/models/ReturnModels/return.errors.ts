import { ApplicationError } from "../../utils/application-error.js";

export class ReturnError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super({
      statusCode,
      code,
      message,
      details,
      isOperational: true
    });
    this.name = "ReturnError";
  }
}

export class InvalidReturnIdError extends ReturnError {
  public constructor() {
    super("INVALID_RETURN_ID", "Return request ID must be a positive safe integer.", 400);
    this.name = "InvalidReturnIdError";
  }
}

export class ReturnOrderItemNotFoundError extends ReturnError {
  public constructor(orderItemId: number) {
    super("RETURN_ORDER_ITEM_NOT_FOUND", `Order item '${orderItemId}' was not found on this order.`, 404, { orderItemId });
    this.name = "ReturnOrderItemNotFoundError";
  }
}

export class ReturnNotEligibleError extends ReturnError {
  public constructor(reason: string) {
    super("RETURN_NOT_ELIGIBLE", `This item cannot be returned: ${reason}`, 422, { reason });
    this.name = "ReturnNotEligibleError";
  }
}

export class ReturnQuantityExceedsAvailableError extends ReturnError {
  public constructor(requested: number, available: number) {
    super(
      "RETURN_QUANTITY_EXCEEDS_AVAILABLE",
      `Requested return quantity (${requested}) exceeds the quantity still eligible for return (${available}).`,
      422,
      { requested, available }
    );
    this.name = "ReturnQuantityExceedsAvailableError";
  }
}

export class ReturnRequestNotFoundError extends ReturnError {
  public constructor(identifier: string | number) {
    super("RETURN_REQUEST_NOT_FOUND", `Return request '${identifier}' was not found.`, 404);
    this.name = "ReturnRequestNotFoundError";
  }
}

export class ReturnAlreadyReviewedError extends ReturnError {
  public constructor(status: string) {
    super("RETURN_ALREADY_REVIEWED", `This return request has already been reviewed (status: '${status}') and cannot be reviewed again.`, 409, { status });
    this.name = "ReturnAlreadyReviewedError";
  }
}

export class ReturnNotApprovedError extends ReturnError {
  public constructor(status: string) {
    super("RETURN_NOT_APPROVED", `This return request must be approved before a refund can be initiated (current status: '${status}').`, 422, { status });
    this.name = "ReturnNotApprovedError";
  }
}

// The gap this closes: without this check, a refund (return type) or a
// replacement (replacement type) could be triggered off a customer photo +
// admin approval alone, with no record the physical item ever came back.
export class ReturnItemNotReceivedError extends ReturnError {
  public constructor(returnId: number) {
    super(
      "RETURN_ITEM_NOT_RECEIVED",
      `Return request '${returnId}' has not been confirmed as physically received back yet — mark it received before approving a replacement or initiating a refund.`,
      422,
      { returnId }
    );
    this.name = "ReturnItemNotReceivedError";
  }
}

export class ReturnItemAlreadyReceivedError extends ReturnError {
  public constructor(returnId: number) {
    super("RETURN_ITEM_ALREADY_RECEIVED", `Return request '${returnId}' has already been marked as received.`, 409, { returnId });
    this.name = "ReturnItemAlreadyReceivedError";
  }
}

export class ReturnItemReceiptNotApplicableError extends ReturnError {
  public constructor(status: string) {
    super(
      "RETURN_ITEM_RECEIPT_NOT_APPLICABLE",
      `Return request cannot be marked received in its current state ('${status}') — it has already been rejected or resolved.`,
      422,
      { status }
    );
    this.name = "ReturnItemReceiptNotApplicableError";
  }
}
