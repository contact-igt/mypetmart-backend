import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { r2Config } from "../../config/r2.config.js";
import {
  ImageTooLargeError,
  ImageTypeNotAllowedError,
  ImageUploadNotFoundError,
  ImageUploadVerificationFailedError,
  InvalidImageUploadIntentError,
  R2NotConfiguredError
} from "./object-storage.errors.js";
import { R2ObjectStorageProvider } from "./r2-object-storage.provider.js";
import type {
  ObjectStorageProvider,
  ProductImageUploadAuthorization,
  VerifiedProductImageUpload
} from "./object-storage.types.js";

const PRODUCT_IMAGE_TYPES = Object.freeze({
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp"
} as const);

const NEW_PRODUCT_IMAGE_KEY_PATTERN = /^products\/(\d+)\/uploads\/(\d{4})\/(\d{2})\/(\d{2})\/([0-9a-f-]{36})\.(jpg|png|webp)$/;

type SupportedProductImageType = keyof typeof PRODUCT_IMAGE_TYPES;

type UploadIntent = {
  version: 1;
  productId: number;
  r2Key: string;
  contentType: SupportedProductImageType;
  sizeBytes: number;
  expiresAtEpochSeconds: number;
};

export type ObjectStorageRuntimeConfig = {
  ready: boolean;
  publicBaseUrl: string | undefined;
  uploadIntentSecret: string | undefined;
  uploadUrlExpirySeconds: number;
  maxImageSizeBytes: number;
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
    if (intent.productId !== productId || !this.isAuthorizedProductImageKey(productId, intent.r2Key)) {
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

      const candidate = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<UploadIntent>;
      if (
        candidate.version !== 1 ||
        !Number.isSafeInteger(candidate.productId) ||
        (candidate.productId ?? 0) <= 0 ||
        typeof candidate.r2Key !== "string" ||
        typeof candidate.contentType !== "string" ||
        !isSupportedProductImageType(candidate.contentType) ||
        !Number.isSafeInteger(candidate.sizeBytes) ||
        (candidate.sizeBytes ?? 0) <= 0 ||
        !Number.isSafeInteger(candidate.expiresAtEpochSeconds) ||
        (candidate.expiresAtEpochSeconds ?? 0) < Math.floor(Date.now() / 1000)
      ) {
        throw new Error("Invalid claims");
      }
      return candidate as UploadIntent;
    } catch {
      throw new InvalidImageUploadIntentError();
    }
  }
}

export const objectStorageService = new ObjectStorageService();
