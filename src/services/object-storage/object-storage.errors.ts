import { ApplicationError } from "../../utils/application-error.js";

export class ObjectStorageError extends ApplicationError {
  public constructor(statusCode: number, code: string, message: string) {
    super({ statusCode, code, message, isOperational: true });
    this.name = "ObjectStorageError";
  }
}

export class R2NotConfiguredError extends ObjectStorageError {
  public constructor() {
    super(503, "R2_NOT_CONFIGURED", "Cloudflare R2 image storage is not configured.");
    this.name = "R2NotConfiguredError";
  }
}

export class ImageTypeNotAllowedError extends ObjectStorageError {
  public constructor() {
    super(415, "IMAGE_TYPE_NOT_ALLOWED", "Only JPEG, PNG, and WebP product images are allowed.");
    this.name = "ImageTypeNotAllowedError";
  }
}

export class ImageTooLargeError extends ObjectStorageError {
  public constructor(maximumBytes: number) {
    super(413, "IMAGE_TOO_LARGE", `Product images must not exceed ${maximumBytes} bytes.`);
    this.name = "ImageTooLargeError";
  }
}

export class InvalidImageUploadIntentError extends ObjectStorageError {
  public constructor() {
    super(400, "INVALID_IMAGE_UPLOAD_INTENT", "The image upload authorization is invalid or expired.");
    this.name = "InvalidImageUploadIntentError";
  }
}

export class ImageUploadNotFoundError extends ObjectStorageError {
  public constructor() {
    super(404, "IMAGE_UPLOAD_NOT_FOUND", "The authorized image upload was not found in Cloudflare R2.");
    this.name = "ImageUploadNotFoundError";
  }
}

export class ImageUploadVerificationFailedError extends ObjectStorageError {
  public constructor(reason: string) {
    super(422, "IMAGE_UPLOAD_VERIFICATION_FAILED", reason);
    this.name = "ImageUploadVerificationFailedError";
  }
}

export class R2OperationFailedError extends ObjectStorageError {
  public constructor(operation: "presign" | "inspect" | "delete" | "list") {
    super(502, "R2_OPERATION_FAILED", `Cloudflare R2 ${operation} operation failed.`);
    this.name = "R2OperationFailedError";
  }
}
