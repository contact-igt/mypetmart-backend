import { ApplicationError } from "../../utils/application-error.js";

export class NewsletterError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super({
      statusCode,
      code,
      message,
      details,
      isOperational: true
    });
    this.name = "NewsletterError";
  }
}

export class NewsletterInvalidVerificationTokenError extends NewsletterError {
  public constructor() {
    super("NEWSLETTER_VERIFICATION_TOKEN_INVALID", "This confirmation link is invalid or has expired.", 404);
    this.name = "NewsletterInvalidVerificationTokenError";
  }
}

export class NewsletterInvalidUnsubscribeTokenError extends NewsletterError {
  public constructor() {
    super("NEWSLETTER_UNSUBSCRIBE_TOKEN_INVALID", "This unsubscribe link is invalid or has expired.", 404);
    this.name = "NewsletterInvalidUnsubscribeTokenError";
  }
}

export class NewsletterEmailDeliveryFailedError extends NewsletterError {
  public constructor() {
    super("NEWSLETTER_EMAIL_DELIVERY_FAILED", "We couldn't send the confirmation email. Please try again later.", 502);
    this.name = "NewsletterEmailDeliveryFailedError";
  }
}
