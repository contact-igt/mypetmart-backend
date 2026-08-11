import { ApplicationError } from "../../utils/application-error.js";

export class CheckoutError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({
      statusCode,
      code,
      message,
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
