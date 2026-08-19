import { ApplicationError } from "../../utils/application-error.js";

export class MediaAssetError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super({
      statusCode,
      code,
      message,
      details,
      isOperational: true
    });
    this.name = "MediaAssetError";
  }
}

export class MediaAssetNotFoundError extends MediaAssetError {
  public constructor(identifier: string | number) {
    super("MEDIA_ASSET_NOT_FOUND", `Media asset '${identifier}' was not found.`, 404);
    this.name = "MediaAssetNotFoundError";
  }
}

export class InvalidMediaAssetIdError extends MediaAssetError {
  public constructor() {
    super("INVALID_MEDIA_ASSET_ID", "Media asset ID must be a positive safe integer.", 400);
    this.name = "InvalidMediaAssetIdError";
  }
}

export class MediaAssetInUseError extends MediaAssetError {
  public constructor(usageCount: number, productIds: number[]) {
    super(
      "MEDIA_ASSET_IN_USE",
      `This media asset is attached to ${usageCount} Product image${usageCount === 1 ? "" : "s"} and cannot be deleted.`,
      409,
      { usageCount, productIds }
    );
    this.name = "MediaAssetInUseError";
  }
}
