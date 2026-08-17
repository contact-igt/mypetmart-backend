import { ApplicationError } from "../../utils/application-error.js";

export class AddressError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({
      statusCode,
      code,
      message,
      isOperational: true
    });
    this.name = "AddressError";
  }
}

export class InvalidAddressIdError extends AddressError {
  public constructor() {
    super("INVALID_ADDRESS_ID", "Address ID must be a positive safe integer.", 400);
    this.name = "InvalidAddressIdError";
  }
}

export class AddressNotFoundError extends AddressError {
  public constructor(identifier: string | number) {
    super("ADDRESS_NOT_FOUND", `Address '${identifier}' was not found.`, 404);
    this.name = "AddressNotFoundError";
  }
}

export class AddressDefaultRequiredError extends AddressError {
  public constructor() {
    super(
      "ADDRESS_DEFAULT_REQUIRED",
      "At least one default address is required while addresses exist. Set a different address as default instead of unsetting this one.",
      422
    );
    this.name = "AddressDefaultRequiredError";
  }
}
