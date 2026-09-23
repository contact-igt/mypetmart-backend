import { ApplicationError } from "../../utils/application-error.js";

export class WelcomePopupError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400) {
    super({ statusCode, code, message, isOperational: true });
    this.name = "WelcomePopupError";
  }
}

export class WelcomePopupNotFoundError extends WelcomePopupError {
  public constructor() {
    super("WELCOME_POPUP_NOT_FOUND", "Welcome popup not found.", 404);
    this.name = "WelcomePopupNotFoundError";
  }
}

export class InvalidWelcomePopupIdError extends WelcomePopupError {
  public constructor() {
    super("INVALID_WELCOME_POPUP_ID", "Welcome popup ID must be a positive integer.", 400);
    this.name = "InvalidWelcomePopupIdError";
  }
}

export class InvalidWelcomePopupDataError extends WelcomePopupError {
  public constructor(message: string = "Invalid welcome popup data.") {
    super("INVALID_WELCOME_POPUP_DATA", message, 400);
    this.name = "InvalidWelcomePopupDataError";
  }
}

export class WelcomePopupMediaNotFoundError extends WelcomePopupError {
  public constructor(field: "desktop" | "mobile") {
    super("WELCOME_POPUP_MEDIA_NOT_FOUND", `The selected ${field} image could not be found in the media library.`, 400);
    this.name = "WelcomePopupMediaNotFoundError";
  }
}

export class WelcomePopupMediaNotImageError extends WelcomePopupError {
  public constructor(field: "desktop" | "mobile") {
    super("WELCOME_POPUP_MEDIA_NOT_IMAGE", `The selected ${field} media asset is not an image.`, 400);
    this.name = "WelcomePopupMediaNotImageError";
  }
}

// Thrown by assertPublishReady — content is missing something the selected
// template requires before it can move out of draft.
export class WelcomePopupNotReadyToPublishError extends WelcomePopupError {
  public constructor(message: string) {
    super("WELCOME_POPUP_NOT_READY_TO_PUBLISH", message, 422);
    this.name = "WelcomePopupNotReadyToPublishError";
  }
}

export class WelcomePopupNotPublishedError extends WelcomePopupError {
  public constructor() {
    super("WELCOME_POPUP_NOT_PUBLISHED", "Only a published popup can be activated on the homepage.", 409);
    this.name = "WelcomePopupNotPublishedError";
  }
}

// Surfaced when the database's own single-active-popup constraint (see
// WelcomePopupTable's homepage_active_flag generated column) rejects a
// commit that raced another activation — the caller should retry.
export class WelcomePopupActivationConflictError extends WelcomePopupError {
  public constructor() {
    super("WELCOME_POPUP_ACTIVATION_CONFLICT", "Another popup was activated at the same moment. Please try again.", 409);
    this.name = "WelcomePopupActivationConflictError";
  }
}
