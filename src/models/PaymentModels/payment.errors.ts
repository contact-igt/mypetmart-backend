import { ApplicationError } from "../../utils/application-error.js";

export class PaymentError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super({
      statusCode,
      code,
      message,
      details,
      isOperational: true
    });
    this.name = "PaymentError";
  }
}

export class PaymentAttemptAlreadyActiveError extends PaymentError {
  public constructor(orderId: number) {
    super(
      "PAYMENT_ATTEMPT_ALREADY_ACTIVE",
      `An active payment attempt already exists for order '${orderId}'.`,
      409,
      { orderId }
    );
    this.name = "PaymentAttemptAlreadyActiveError";
  }
}

export class OrderAlreadyPaidError extends PaymentError {
  public constructor(orderId: number) {
    super(
      "ORDER_ALREADY_PAID",
      `Order '${orderId}' is already paid or has a successful payment.`,
      409,
      { orderId }
    );
    this.name = "OrderAlreadyPaidError";
  }
}

// ---------------------------------------------------------------------------
// Payment Initiation (PayU Hosted Checkout)
// ---------------------------------------------------------------------------

export class PaymentGuestTokenRequiredError extends PaymentError {
  public constructor() {
    super(
      "PAYMENT_GUEST_TOKEN_REQUIRED",
      "A guest order recovery token is required to initiate payment for a guest order.",
      400
    );
    this.name = "PaymentGuestTokenRequiredError";
  }
}

// A signed-in customer must identify the Order by orderId (ownership comes
// from the session), never by presenting a guest recovery token — mixing the
// two identity sources would let a customer's session ride along with a
// guest token that was never proven to belong to them.
export class PaymentCustomerOrderIdRequiredError extends PaymentError {
  public constructor() {
    super(
      "PAYMENT_CUSTOMER_ORDER_ID_REQUIRED",
      "An authenticated customer must identify the order by orderId, not a guest recovery token.",
      400
    );
    this.name = "PaymentCustomerOrderIdRequiredError";
  }
}

export class PaymentOrderNotPayableError extends PaymentError {
  public constructor(orderId: number, reason: string) {
    super("PAYMENT_ORDER_NOT_PAYABLE", `Order '${orderId}' cannot be paid: ${reason}`, 422, { orderId, reason });
    this.name = "PaymentOrderNotPayableError";
  }
}

export class PaymentProviderNotConfiguredError extends PaymentError {
  public constructor() {
    super("PAYMENT_PROVIDER_NOT_CONFIGURED", "The payment provider is not configured.", 503);
    this.name = "PaymentProviderNotConfiguredError";
  }
}

// A pending online Payment Attempt for the Order could not be authoritatively
// resolved (PayU Verify returned an uncertain result or was unreachable, or a
// Breeze attempt is pending and Breeze has no client-pollable verify API).
// Cancelling would risk abandoning an Order that a provider actually captured
// funds for, so the caller must retry once the provider state settles. The
// message is deliberately provider-agnostic and safe for a customer to read.
export class PaymentStatusUncertainError extends PaymentError {
  public constructor(orderId: number) {
    super(
      "PAYMENT_STATUS_UNCERTAIN",
      "We are still checking the payment status for this order. Please try again shortly.",
      409,
      { orderId }
    );
    this.name = "PaymentStatusUncertainError";
  }
}
