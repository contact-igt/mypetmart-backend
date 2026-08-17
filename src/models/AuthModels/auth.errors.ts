import { ApplicationError } from "../../utils/application-error.js";

export class AuthError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({
      statusCode,
      code,
      message,
      isOperational: true
    });
    this.name = "AuthError";
  }
}

export class InvalidCredentialsError extends AuthError {
  public constructor() {
    super("AUTH_INVALID_CREDENTIALS", "Invalid email or password.", 401);
  }
}

export class AccountDisabledError extends AuthError {
  public constructor() {
    super("AUTH_ACCOUNT_DISABLED", "Your account has been disabled.", 403);
  }
}

export class EmailAlreadyExistsError extends AuthError {
  public constructor() {
    super("AUTH_EMAIL_ALREADY_EXISTS", "A user with this email address already exists.", 409);
  }
}

export class TokenMissingError extends AuthError {
  public constructor() {
    super("AUTH_TOKEN_MISSING", "Authentication token is missing.", 401);
  }
}

export class TokenInvalidError extends AuthError {
  public constructor() {
    super("AUTH_TOKEN_INVALID", "Authentication token is invalid.", 401);
  }
}

export class TokenExpiredError extends AuthError {
  public constructor() {
    super("AUTH_TOKEN_EXPIRED", "Authentication token has expired.", 401);
  }
}

export class SessionInvalidError extends AuthError {
  public constructor() {
    super("AUTH_SESSION_INVALID", "Session is invalid.", 401);
  }
}

export class SessionRevokedError extends AuthError {
  public constructor() {
    super("AUTH_SESSION_REVOKED", "Session has been revoked.", 401);
  }
}

export class ForbiddenError extends AuthError {
  public constructor() {
    super("AUTH_FORBIDDEN", "You do not have permission to access this resource.", 403);
  }
}

export class ValidationError extends AuthError {
  public readonly errors: Record<string, string[]>;
  public constructor(errors: Record<string, string[]>) {
    super("AUTH_VALIDATION_FAILED", "Validation failed.", 400);
    this.errors = errors;
  }
}
