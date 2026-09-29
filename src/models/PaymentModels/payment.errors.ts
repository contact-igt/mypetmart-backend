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

// The Order's coupon discount is restricted to one payment method and the
// caller is trying to pay through the other one.
export class CouponPaymentMethodMismatchError extends PaymentError {
  public constructor(orderId: number, eligiblePaymentMethod: "payu" | "cod") {
    const label = eligiblePaymentMethod === "payu" ? "Prepaid (Pay Online)" : "Cash on Delivery";
    super("COUPON_PAYMENT_METHOD_MISMATCH", `This order's coupon is valid only for ${label}.`, 422, { orderId, eligiblePaymentMethod });
    this.name = "CouponPaymentMethodMismatchError";
  }
}

// The Order was priced with the Global Pay Online Discount, so its persisted
// total is only valid for online payment. COD would collect a discounted
// amount the store only grants for prepaid orders.
export class OnlinePaymentDiscountMethodMismatchError extends PaymentError {
  public constructor(orderId: number) {
    super("ONLINE_PAYMENT_DISCOUNT_METHOD_MISMATCH", "This order includes a Pay Online discount and can only be paid online.", 422, { orderId });
    this.name = "OnlinePaymentDiscountMethodMismatchError";
  }
}

// One or more of the Order's items (by their order-time eligibility snapshot)
// cannot be paid with the requested method.
export class ProductPaymentMethodMismatchError extends PaymentError {
  public constructor(orderId: number, requested: "payu" | "cod", message: string) {
    super("PRODUCT_PAYMENT_METHOD_MISMATCH", message, 422, { orderId, requested });
    this.name = "ProductPaymentMethodMismatchError";
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
