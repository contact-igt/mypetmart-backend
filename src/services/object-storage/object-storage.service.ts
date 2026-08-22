import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { r2Config } from "../../config/r2.config.js";
import {
  ImageTooLargeError,
  ImageTypeNotAllowedError,
  ImageUploadNotFoundError,
  ImageUploadVerificationFailedError,
  InvalidImageUploadIntentError,
  MediaTypeNotAllowedError,
  R2NotConfiguredError,
  VideoTooLargeError
} from "./object-storage.errors.js";
import { R2ObjectStorageProvider } from "./r2-object-storage.provider.js";
import type {
  MediaAssetUploadAuthorization,
  ObjectStorageProvider,
  ProductImageUploadAuthorization,
  VerifiedMediaAssetUpload,
  VerifiedProductImageUpload
} from "./object-storage.types.js";

const PRODUCT_IMAGE_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
} as const);

// Media Library-only: the Product direct-image upload path (presignProductImageUpload
// / verifyProductImageUpload / isAuthorizedProductImageKey) intentionally keeps using
// PRODUCT_IMAGE_TYPES above and never this superset, so a video can never be attached
// as a Product's directly-uploaded image.
const MEDIA_LIBRARY_VIDEO_TYPES = Object.freeze({
  "video/mp4": "mp4"
} as const);

const MEDIA_LIBRARY_TYPES = Object.freeze({
  ...PRODUCT_IMAGE_TYPES,
  ...MEDIA_LIBRARY_VIDEO_TYPES
} as const);

const NEW_PRODUCT_IMAGE_KEY_PATTERN = /^products\/(\d+)\/uploads\/(\d{4})\/(\d{2})\/(\d{2})\/([0-9a-f-]{36})\.(jpg|png|webp)$/;
const MEDIA_ASSET_KEY_PATTERN = /^media\/(\d{4})\/(\d{2})\/(\d{2})\/([0-9a-f-]{36})\.(jpg|png|webp|mp4)$/;

type SupportedProductImageType = keyof typeof PRODUCT_IMAGE_TYPES;
type SupportedMediaLibraryType = keyof typeof MEDIA_LIBRARY_TYPES;

type ProductImageUploadIntent = {
  version: 1;
  scope: "product_image";
  productId: number;
  r2Key: string;
  contentType: SupportedProductImageType;
  sizeBytes: number;
  expiresAtEpochSeconds: number;
};

// Media Assets are not scoped to any single Product (that is the point of a
// reusable library), so their upload intent deliberately carries no
// productId — it is verified only against MEDIA_ASSET_KEY_PATTERN's "media/"
// namespace instead of a "products/{id}/" one.
type MediaAssetUploadIntent = {
  version: 1;
  scope: "media_asset";
  r2Key: string;
  contentType: SupportedMediaLibraryType;
  sizeBytes: number;
  expiresAtEpochSeconds: number;
};

type UploadIntent = ProductImageUploadIntent | MediaAssetUploadIntent;

export type ObjectStorageRuntimeConfig = {
  ready: boolean;
  publicBaseUrl: string | undefined;
  uploadIntentSecret: string | undefined;
  uploadUrlExpirySeconds: number;
  maxImageSizeBytes: number;
  maxVideoSizeBytes: number;
  orphanGraceHours: number;
};

export type OrphanCleanupResult = {
  inspected: number;
  deleted: number;
};

function normalizeContentType(value: string): string {
  return value.split(";", 1)[0]!.trim().toLowerCase();
}

function isSupportedProductImageType(value: string): value is SupportedProductImageType {
  return Object.hasOwn(PRODUCT_IMAGE_TYPES, value);
}

function isSupportedMediaLibraryType(value: string): value is SupportedMediaLibraryType {
  return Object.hasOwn(MEDIA_LIBRARY_TYPES, value);
}

function isMediaLibraryVideoType(value: string): value is keyof typeof MEDIA_LIBRARY_VIDEO_TYPES {
  return Object.hasOwn(MEDIA_LIBRARY_VIDEO_TYPES, value);
}

function isSafeProductImageKey(productId: number, key: string): boolean {
  const hasControlCharacter = Array.from(key).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127);
  if (key.length < 1 || key.length > 512 || key.includes("..") || key.includes("\\") || hasControlCharacter) {
    return false;
  }
  return key.startsWith(`products/${productId}/`);
}

export class ObjectStorageService {
  readonly #config: ObjectStorageRuntimeConfig;
  #provider: ObjectStorageProvider | undefined;

  public constructor(config: ObjectStorageRuntimeConfig = r2Config, provider?: ObjectStorageProvider) {
    this.#config = config;
    this.#provider = provider;
  }

  public getReadiness(): { provider: "cloudflare_r2"; status: "configured" | "not_configured" } {
    return { provider: "cloudflare_r2", status: this.#config.ready ? "configured" : "not_configured" };
  }

  public ensureConfigured(): void {
    if (!this.#config.ready || !this.#config.publicBaseUrl || !this.#config.uploadIntentSecret) {
      throw new R2NotConfiguredError();
    }
  }

  public getPublicUrl(key: string): string | undefined {
    if (!this.#config.publicBaseUrl) return undefined;
    const base = this.#config.publicBaseUrl.endsWith("/") ? this.#config.publicBaseUrl : `${this.#config.publicBaseUrl}/`;
    return new URL(key.split("/").map(encodeURIComponent).join("/"), base).toString();
  }

  public async presignProductImageUpload(
    productId: number,
    input: { contentType: string; sizeBytes: number }
  ): Promise<ProductImageUploadAuthorization> {
    const contentType = normalizeContentType(input.contentType);
    if (!isSupportedProductImageType(contentType)) throw new ImageTypeNotAllowedError();
    if (input.sizeBytes > this.#config.maxImageSizeBytes) throw new ImageTooLargeError(this.#config.maxImageSizeBytes);
    this.ensureConfigured();

    const now = new Date();
    const extension = PRODUCT_IMAGE_TYPES[contentType];
    const key = [
      "products",
      String(productId),
      "uploads",
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
      `${randomUUID()}.${extension}`
    ].join("/");
    const expiresAtEpochSeconds = Math.floor(now.getTime() / 1000) + this.#config.uploadUrlExpirySeconds;
    const uploadToken = this.#signIntent({
      version: 1,
      scope: "product_image",
      productId,
      r2Key: key,
      contentType,
      sizeBytes: input.sizeBytes,
      expiresAtEpochSeconds
    });
    const result = await this.#getProvider().createPresignedPut({
      key,
      contentType,
      expiresInSeconds: this.#config.uploadUrlExpirySeconds
    });

    return {
      uploadUrl: result.uploadUrl,
      method: "PUT",
      requiredHeaders: Object.freeze({ "Content-Type": contentType }),
      r2Key: key,
      publicUrl: this.getPublicUrl(key)!,
      expiresAt: new Date(expiresAtEpochSeconds * 1000).toISOString(),
      uploadToken
    };
  }

  public async verifyProductImageUpload(productId: number, uploadToken: string): Promise<VerifiedProductImageUpload> {
    this.ensureConfigured();
    const intent = this.#verifyIntent(uploadToken);
    if (intent.scope !== "product_image" || intent.productId !== productId || !this.isAuthorizedProductImageKey(productId, intent.r2Key)) {
      throw new InvalidImageUploadIntentError();
    }

    const object = await this.#getProvider().headObject(intent.r2Key);
    if (!object) throw new ImageUploadNotFoundError();
    const actualContentType = object.contentType ? normalizeContentType(object.contentType) : "";
    if (actualContentType !== intent.contentType) {
      throw new ImageUploadVerificationFailedError("The uploaded image content type does not match its authorization.");
    }
    if (object.sizeBytes === undefined || object.sizeBytes !== intent.sizeBytes) {
      throw new ImageUploadVerificationFailedError("The uploaded image size does not match its authorization.");
    }
    if (object.sizeBytes > this.#config.maxImageSizeBytes) throw new ImageTooLargeError(this.#config.maxImageSizeBytes);

    return {
      r2Key: intent.r2Key,
      publicUrl: this.getPublicUrl(intent.r2Key)!,
      contentType: intent.contentType,
      sizeBytes: object.sizeBytes
    };
  }

  public isAuthorizedProductImageKey(productId: number, key: string): boolean {
    const match = NEW_PRODUCT_IMAGE_KEY_PATTERN.exec(key);
    return match !== null && Number(match[1]) === productId;
  }

  public async presignMediaAssetUpload(input: { contentType: string; sizeBytes: number }): Promise<MediaAssetUploadAuthorization> {
    const contentType = normalizeContentType(input.contentType);
    if (!isSupportedMediaLibraryType(contentType)) throw new MediaTypeNotAllowedError();
    const isVideo = isMediaLibraryVideoType(contentType);
    const maxAllowedBytes = isVideo ? this.#config.maxVideoSizeBytes : this.#config.maxImageSizeBytes;
    if (input.sizeBytes > maxAllowedBytes) {
      throw isVideo ? new VideoTooLargeError(maxAllowedBytes) : new ImageTooLargeError(maxAllowedBytes);
    }
    this.ensureConfigured();

    const now = new Date();
    const extension = MEDIA_LIBRARY_TYPES[contentType];
    const key = [
      "media",
      String(now.getUTCFullYear()),
      String(now.getUTCMonth() + 1).padStart(2, "0"),
      String(now.getUTCDate()).padStart(2, "0"),
      `${randomUUID()}.${extension}`
    ].join("/");
    const expiresAtEpochSeconds = Math.floor(now.getTime() / 1000) + this.#config.uploadUrlExpirySeconds;
    const uploadToken = this.#signIntent({
      version: 1,
      scope: "media_asset",
      r2Key: key,
      contentType,
      sizeBytes: input.sizeBytes,
      expiresAtEpochSeconds
    });
    const result = await this.#getProvider().createPresignedPut({
      key,
      contentType,
      expiresInSeconds: this.#config.uploadUrlExpirySeconds
    });

    return {
      uploadUrl: result.uploadUrl,
      method: "PUT",
      requiredHeaders: Object.freeze({ "Content-Type": contentType }),
      r2Key: key,
      publicUrl: this.getPublicUrl(key)!,
      expiresAt: new Date(expiresAtEpochSeconds * 1000).toISOString(),
      uploadToken
    };
  }

  public async verifyMediaAssetUpload(uploadToken: string): Promise<VerifiedMediaAssetUpload> {
    this.ensureConfigured();
    const intent = this.#verifyIntent(uploadToken);
    if (intent.scope !== "media_asset" || !this.isAuthorizedMediaAssetKey(intent.r2Key)) {
      throw new InvalidImageUploadIntentError();
    }

    const object = await this.#getProvider().headObject(intent.r2Key);
    if (!object) throw new ImageUploadNotFoundError();
    const actualContentType = object.contentType ? normalizeContentType(object.contentType) : "";
    if (actualContentType !== intent.contentType) {
      throw new ImageUploadVerificationFailedError("The uploaded media file's content type does not match its authorization.");
    }
    if (object.sizeBytes === undefined || object.sizeBytes !== intent.sizeBytes) {
      throw new ImageUploadVerificationFailedError("The uploaded media file's size does not match its authorization.");
    }
    const isVideo = isMediaLibraryVideoType(intent.contentType);
    const maxAllowedBytes = isVideo ? this.#config.maxVideoSizeBytes : this.#config.maxImageSizeBytes;
    if (object.sizeBytes > maxAllowedBytes) {
      throw isVideo ? new VideoTooLargeError(maxAllowedBytes) : new ImageTooLargeError(maxAllowedBytes);
    }

    return {
      r2Key: intent.r2Key,
      publicUrl: this.getPublicUrl(intent.r2Key)!,
      contentType: intent.contentType,
      sizeBytes: object.sizeBytes
    };
  }

  public isAuthorizedMediaAssetKey(key: string): boolean {
    return MEDIA_ASSET_KEY_PATTERN.test(key);
  }

  public async deleteMediaAssetObject(key: string): Promise<void> {
    this.ensureConfigured();
    if (!this.isAuthorizedMediaAssetKey(key)) {
      throw new ImageUploadVerificationFailedError("The image object key does not belong to the Media Gallery.");
    }
    await this.#getProvider().deleteObject(key);
  }

  public async deleteProductImageObject(productId: number, key: string): Promise<void> {
    this.ensureConfigured();
    if (!isSafeProductImageKey(productId, key)) {
      throw new ImageUploadVerificationFailedError("The image object key does not belong to this product.");
    }
    await this.#getProvider().deleteObject(key);
  }

  public async productImageObjectExists(productId: number, key: string): Promise<boolean> {
    this.ensureConfigured();
    if (!isSafeProductImageKey(productId, key)) {
      throw new ImageUploadVerificationFailedError("The image object key does not belong to this product.");
    }
    return (await this.#getProvider().headObject(key)) !== null;
  }

  public async cleanupUnattachedProductUploads(referencedKeys: ReadonlySet<string>, now = new Date()): Promise<OrphanCleanupResult> {
    this.ensureConfigured();
    const cutoff = now.getTime() - this.#config.orphanGraceHours * 60 * 60 * 1000;
    const objects = await this.#getProvider().listObjects("products/");
    const orphanKeys = objects
      .filter((object) => object.key.includes("/uploads/"))
      .filter((object) => object.lastModified !== undefined && object.lastModified.getTime() < cutoff)
      .filter((object) => !referencedKeys.has(object.key));

    for (const object of orphanKeys) await this.#getProvider().deleteObject(object.key);
    return { inspected: objects.length, deleted: orphanKeys.length };
  }

  #getProvider(): ObjectStorageProvider {
    this.ensureConfigured();
    this.#provider ??= new R2ObjectStorageProvider();
    return this.#provider;
  }

  #signIntent(intent: UploadIntent): string {
    const payload = Buffer.from(JSON.stringify(intent), "utf8").toString("base64url");
    const signature = createHmac("sha256", this.#config.uploadIntentSecret!).update(payload).digest("base64url");
    return `${payload}.${signature}`;
  }

  #verifyIntent(token: string): UploadIntent {
    try {
      const [payload, signature, extra] = token.split(".");
      if (!payload || !signature || extra !== undefined) throw new Error("Malformed token");
      const expected = createHmac("sha256", this.#config.uploadIntentSecret!).update(payload).digest();
      const supplied = Buffer.from(signature, "base64url");
      if (supplied.toString("base64url") !== signature || supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        throw new Error("Invalid signature");
      }

      const candidate = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<UploadIntent> & { scope?: unknown; productId?: unknown };
      if (
        candidate.version !== 1 ||
        typeof candidate.r2Key !== "string" ||
        typeof candidate.contentType !== "string" ||
        !Number.isSafeInteger(candidate.sizeBytes) ||
        (candidate.sizeBytes ?? 0) <= 0 ||
        !Number.isSafeInteger(candidate.expiresAtEpochSeconds) ||
        (candidate.expiresAtEpochSeconds ?? 0) < Math.floor(Date.now() / 1000)
      ) {
        throw new Error("Invalid claims");
      }

      if (candidate.scope === "product_image") {
        if (
          !isSupportedProductImageType(candidate.contentType) ||
          !Number.isSafeInteger(candidate.productId) ||
          (candidate.productId as number) <= 0
        ) {
          throw new Error("Invalid claims");
        }
        return candidate as ProductImageUploadIntent;
      }

      // Media Library intents accept the wider image+video allow-list — this is the
      // ONLY scope that may carry a video contentType (see MEDIA_LIBRARY_TYPES comment).
      if (candidate.scope === "media_asset") {
        if (!isSupportedMediaLibraryType(candidate.contentType)) {
          throw new Error("Invalid claims");
        }
        return candidate as MediaAssetUploadIntent;
      }

      throw new Error("Invalid claims");
    } catch {
      throw new InvalidImageUploadIntentError();
    }
  }
}

export const objectStorageService = new ObjectStorageService();
