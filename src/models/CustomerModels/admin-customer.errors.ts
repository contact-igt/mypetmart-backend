import { ApplicationError } from "../../utils/application-error.js";

export class CustomerError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({
      statusCode,
      code,
      message,
      isOperational: true
    });
    this.name = "CustomerError";
  }
}

export class CustomerNotFoundError extends CustomerError {
  public constructor() {
    super("CUSTOMER_NOT_FOUND", "Customer not found.", 404);
  }
}

export class InvalidCustomerIdError extends CustomerError {
  public constructor() {
    super("INVALID_CUSTOMER_ID", "Customer ID must be a positive integer.", 400);
  }
}
