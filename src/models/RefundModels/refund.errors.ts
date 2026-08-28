import { ApplicationError } from "../../utils/application-error.js";

export class RefundError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super({
      statusCode,
      code,
      message,
      details,
      isOperational: true
    });
    this.name = "RefundError";
  }
}

export class RefundProviderNotConfiguredError extends RefundError {
  public constructor() {
    super("REFUND_PROVIDER_NOT_CONFIGURED", "The refund provider is not configured (missing PayU credentials or a public callback origin).", 503);
    this.name = "RefundProviderNotConfiguredError";
  }
}

export class RefundReturnNotApprovedError extends RefundError {
  public constructor(status: string) {
    super("REFUND_RETURN_NOT_APPROVED", `A refund can only be initiated for an approved return request (current status: '${status}').`, 422, { status });
    this.name = "RefundReturnNotApprovedError";
  }
}

export class RefundResolutionMismatchError extends RefundError {
  public constructor() {
    super("REFUND_RESOLUTION_MISMATCH", "This return request selected a replacement, not a refund.", 422);
    this.name = "RefundResolutionMismatchError";
  }
}

export class RefundNoPaidPaymentFoundError extends RefundError {
  public constructor(orderId: number) {
    super("REFUND_NO_PAID_PAYMENT_FOUND", `Order '${orderId}' has no paid or partially-refunded Payment to refund against.`, 422, { orderId });
    this.name = "RefundNoPaidPaymentFoundError";
  }
}

export class RefundPaymentMissingProviderIdError extends RefundError {
  public constructor(paymentId: number) {
    super("REFUND_PAYMENT_MISSING_PROVIDER_ID", `Payment '${paymentId}' has no PayU transaction id (mihpayid) on record and cannot be refunded.`, 422, { paymentId });
    this.name = "RefundPaymentMissingProviderIdError";
  }
}

export class RefundCodManualProcessingRequiredError extends RefundError {
  public constructor(paymentId: number) {
    super(
      "REFUND_COD_MANUAL_PROCESSING_REQUIRED",
      "COD refunds are handled manually and cannot be initiated through the online refund flow.",
      422,
      { paymentId }
    );
    this.name = "RefundCodManualProcessingRequiredError";
  }
}

export class RefundExceedsRefundableBalanceError extends RefundError {
  public constructor(requested: string, refundable: string) {
    super(
      "REFUND_EXCEEDS_REFUNDABLE_BALANCE",
      `Refund amount (${requested}) exceeds the remaining refundable balance (${refundable}) for this payment.`,
      422,
      { requested, refundable }
    );
    this.name = "RefundExceedsRefundableBalanceError";
  }
}

export class RefundAlreadyInitiatedError extends RefundError {
  public constructor(returnId: number) {
    super("REFUND_ALREADY_INITIATED", `A refund has already been initiated for return request '${returnId}'.`, 409, { returnId });
    this.name = "RefundAlreadyInitiatedError";
  }
}

export class RefundNotFoundError extends RefundError {
  public constructor(identifier: string | number) {
    super("REFUND_NOT_FOUND", `Refund '${identifier}' was not found.`, 404);
    this.name = "RefundNotFoundError";
  }
}

export class RefundWebhookInvalidPayloadError extends RefundError {
  public constructor() {
    super("REFUND_WEBHOOK_INVALID_PAYLOAD", "The refund webhook payload is missing required fields.", 400);
    this.name = "RefundWebhookInvalidPayloadError";
  }
}
