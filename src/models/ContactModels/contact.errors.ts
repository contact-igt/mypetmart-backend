import { ApplicationError } from "../../utils/application-error.js";

export class ContactError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({
      statusCode,
      code,
      message,
      isOperational: true
    });
    this.name = "ContactError";
  }
}

export class ContactEnquiryNotFoundError extends ContactError {
  public constructor() {
    super("CONTACT_ENQUIRY_NOT_FOUND", "Contact enquiry not found.", 404);
    this.name = "ContactEnquiryNotFoundError";
  }
}

export class InvalidContactEnquiryIdError extends ContactError {
  public constructor() {
    super("INVALID_CONTACT_ENQUIRY_ID", "Contact enquiry ID must be a positive integer.", 400);
    this.name = "InvalidContactEnquiryIdError";
  }
}
