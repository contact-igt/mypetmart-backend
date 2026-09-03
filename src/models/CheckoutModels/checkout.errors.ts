import { ApplicationError } from "../../utils/application-error.js";

export class CheckoutError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super({
      statusCode,
      code,
      message,
      details,
      isOperational: true
    });
    this.name = "CheckoutError";
  }
}

export class CheckoutCartEmptyError extends CheckoutError {
  public constructor() {
    super("CHECKOUT_CART_EMPTY", "Your cart is empty. Add items before checking out.", 422);
    this.name = "CheckoutCartEmptyError";
  }
}

export class CheckoutAddressRequiredError extends CheckoutError {
  public constructor() {
    super("CHECKOUT_ADDRESS_REQUIRED", "A delivery address is required to preview checkout.", 400);
    this.name = "CheckoutAddressRequiredError";
  }
}

export class CheckoutAddressNotFoundError extends CheckoutError {
  public constructor(identifier: string | number) {
    super("CHECKOUT_ADDRESS_NOT_FOUND", `Address '${identifier}' was not found.`, 404);
    this.name = "CheckoutAddressNotFoundError";
  }
}

// Guest-only: a contact email is required so a future payment provider has a
// valid address for receipts/correspondence. Never thrown for an
// authenticated customer — their account email is always server-derived
// instead (see checkout.service.ts's resolveContactEmail).
export class CheckoutEmailRequiredError extends CheckoutError {
  public constructor() {
    super("CHECKOUT_EMAIL_REQUIRED", "A contact email is required to preview checkout as a guest.", 400);
    this.name = "CheckoutEmailRequiredError";
  }
}

export class CheckoutInvalidPincodeError extends CheckoutError {
  public constructor() {
    super("CHECKOUT_INVALID_PINCODE", "Enter a valid 6-digit Indian pincode.", 422);
    this.name = "CheckoutInvalidPincodeError";
  }
}

export class CheckoutServiceabilityUnavailableError extends CheckoutError {
  public constructor() {
    super("CHECKOUT_SERVICEABILITY_UNAVAILABLE", "Delivery availability is temporarily unavailable. Please try again.", 503);
    this.name = "CheckoutServiceabilityUnavailableError";
  }
}

export class CheckoutDestinationUnserviceableError extends CheckoutError {
  public constructor(paymentMode: "prepaid" | "cod") {
    super(
      "CHECKOUT_DESTINATION_UNSERVICEABLE",
      paymentMode === "cod" ? "Cash on Delivery is not available for this pincode." : "We do not currently deliver to this pincode.",
      422,
      { paymentMode }
    );
    this.name = "CheckoutDestinationUnserviceableError";
  }
}

export class CheckoutCodUnavailableError extends CheckoutError {
  public constructor() {
    super("CHECKOUT_COD_UNAVAILABLE", "Cash on Delivery is not available for this delivery address.", 422);
    this.name = "CheckoutCodUnavailableError";
  }
}
