import { describe, expect, it } from "vitest";

import { ObjectStorageService, type ObjectStorageRuntimeConfig } from "../../src/services/object-storage/object-storage.service.js";
import type {
  ListedStoredObject,
  ObjectStorageProvider,
  PresignedPutRequest,
  StoredObjectMetadata
} from "../../src/services/object-storage/object-storage.types.js";

const TEST_INTENT_SECRET = "test_r2_upload_intent_secret_that_is_long_enough_123456";

class FakeObjectStorageProvider implements ObjectStorageProvider {
  public presignedRequest: PresignedPutRequest | undefined;
  public headResult: StoredObjectMetadata | null = null;
  public listedObjects: ListedStoredObject[] = [];
  public deletedKeys: string[] = [];

  public createPresignedPut(request: PresignedPutRequest): Promise<{ uploadUrl: string }> {
    this.presignedRequest = request;
    return Promise.resolve({ uploadUrl: "https://r2.example.test/signed-upload?signature=opaque" });
  }

  public headObject(_key: string): Promise<StoredObjectMetadata | null> {
    return Promise.resolve(this.headResult);
  }

  public deleteObject(key: string): Promise<void> {
    this.deletedKeys.push(key);
    return Promise.resolve();
  }

  public listObjects(_prefix: string): Promise<ListedStoredObject[]> {
    return Promise.resolve(this.listedObjects);
  }
}

function configuredRuntime(overrides: Partial<ObjectStorageRuntimeConfig> = {}): ObjectStorageRuntimeConfig {
  return {
    ready: true,
    publicBaseUrl: "https://images.mypetmart.test",
    uploadIntentSecret: TEST_INTENT_SECRET,
    uploadUrlExpirySeconds: 300,
    maxImageSizeBytes: 10 * 1024 * 1024,
    orphanGraceHours: 24,
    ...overrides
  };
}

describe("Cloudflare R2 object storage lifecycle", () => {
  it.each([
    ["image/jpeg", "jpg"],
    ["image/png", "png"],
    ["image/webp", "webp"]
  ])("creates a short-lived, Product-scoped %s presign contract without exposing secrets", async (contentType, extension) => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime(), provider);

    const result = await service.presignProductImageUpload(42, { contentType, sizeBytes: 2048 });

    expect(result.method).toBe("PUT");
    expect(result.requiredHeaders).toEqual({ "Content-Type": contentType });
    expect(result.r2Key).toMatch(new RegExp(`^products/42/uploads/\\d{4}/\\d{2}/\\d{2}/[0-9a-f-]{36}\\.${extension}$`));
    expect(result.publicUrl).toBe(`https://images.mypetmart.test/${result.r2Key}`);
    expect(provider.presignedRequest?.expiresInSeconds).toBe(300);
    expect(JSON.stringify(result)).not.toContain(TEST_INTENT_SECRET);
    expect(result).not.toHaveProperty("accessKeyId");
    expect(result).not.toHaveProperty("secretAccessKey");
  });

  it.each(["image/gif", "application/pdf", "text/html"])("rejects unsupported MIME type %s", async (contentType) => {
    const service = new ObjectStorageService(configuredRuntime(), new FakeObjectStorageProvider());
    await expect(service.presignProductImageUpload(42, { contentType, sizeBytes: 100 })).rejects.toMatchObject({
      code: "IMAGE_TYPE_NOT_ALLOWED",
      statusCode: 415
    });
  });

  it("rejects an oversized image before asking the provider to presign", async () => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime({ maxImageSizeBytes: 1000 }), provider);
    await expect(service.presignProductImageUpload(42, { contentType: "image/png", sizeBytes: 1001 })).rejects.toMatchObject({
      code: "IMAGE_TOO_LARGE",
      statusCode: 413
    });
    expect(provider.presignedRequest).toBeUndefined();
  });

  it("reports R2 as not configured without creating a provider", async () => {
    const service = new ObjectStorageService(configuredRuntime({ ready: false, uploadIntentSecret: undefined }));
    expect(service.getReadiness().status).toBe("not_configured");
    await expect(service.presignProductImageUpload(42, { contentType: "image/webp", sizeBytes: 100 })).rejects.toMatchObject({
      code: "R2_NOT_CONFIGURED",
      statusCode: 503
    });
  });

  it("verifies authoritative object metadata before returning attachment data", async () => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime(), provider);
    const authorization = await service.presignProductImageUpload(42, { contentType: "image/webp", sizeBytes: 3456 });
    provider.headResult = {
      key: authorization.r2Key,
      contentType: "image/webp",
      sizeBytes: 3456,
      lastModified: new Date()
    };

    await expect(service.verifyProductImageUpload(42, authorization.uploadToken)).resolves.toEqual({
      r2Key: authorization.r2Key,
      publicUrl: `https://images.mypetmart.test/${authorization.r2Key}`,
      contentType: "image/webp",
      sizeBytes: 3456
    });
  });

  it("rejects completion when the authorized object is missing", async () => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime(), provider);
    const authorization = await service.presignProductImageUpload(42, { contentType: "image/png", sizeBytes: 500 });
    await expect(service.verifyProductImageUpload(42, authorization.uploadToken)).rejects.toMatchObject({
      code: "IMAGE_UPLOAD_NOT_FOUND"
    });
  });

  it("rejects completion when R2 content type differs from the authorization", async () => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime(), provider);
    const authorization = await service.presignProductImageUpload(42, { contentType: "image/png", sizeBytes: 500 });
    provider.headResult = { key: authorization.r2Key, contentType: "image/jpeg", sizeBytes: 500, lastModified: new Date() };
    await expect(service.verifyProductImageUpload(42, authorization.uploadToken)).rejects.toMatchObject({
      code: "IMAGE_UPLOAD_VERIFICATION_FAILED"
    });
  });

  it("rejects completion when R2 object size differs from the authorization", async () => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime(), provider);
    const authorization = await service.presignProductImageUpload(42, { contentType: "image/png", sizeBytes: 500 });
    provider.headResult = { key: authorization.r2Key, contentType: "image/png", sizeBytes: 499, lastModified: new Date() };
    await expect(service.verifyProductImageUpload(42, authorization.uploadToken)).rejects.toMatchObject({
      code: "IMAGE_UPLOAD_VERIFICATION_FAILED"
    });
  });

  it("blocks tampered tokens and cross-Product attachment", async () => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime(), provider);
    const authorization = await service.presignProductImageUpload(42, { contentType: "image/jpeg", sizeBytes: 500 });
    const tamperedToken = `${authorization.uploadToken.slice(0, -1)}${authorization.uploadToken.endsWith("a") ? "b" : "a"}`;

    await expect(service.verifyProductImageUpload(42, tamperedToken)).rejects.toMatchObject({ code: "INVALID_IMAGE_UPLOAD_INTENT" });
    await expect(service.verifyProductImageUpload(43, authorization.uploadToken)).rejects.toMatchObject({
      code: "INVALID_IMAGE_UPLOAD_INTENT"
    });
  });

  it("never deletes an object outside the requested Product namespace", async () => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime(), provider);
    await expect(service.deleteProductImageObject(42, "products/43/uploads/2026/01/01/other.jpg")).rejects.toMatchObject({
      code: "IMAGE_UPLOAD_VERIFICATION_FAILED"
    });
    expect(provider.deletedKeys).toEqual([]);
  });

  it("treats a provider's successful delete response as idempotent for missing objects", async () => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime(), provider);
    await service.deleteProductImageObject(42, "products/42/missing.jpg");
    expect(provider.deletedKeys).toEqual(["products/42/missing.jpg"]);
  });

  it("deletes only old unattached uploads during explicit orphan cleanup", async () => {
    const provider = new FakeObjectStorageProvider();
    const service = new ObjectStorageService(configuredRuntime(), provider);
    provider.listedObjects = [
      { key: "products/42/uploads/2026/01/01/orphan.jpg", lastModified: new Date("2026-01-01T00:00:00Z") },
      { key: "products/42/uploads/2026/01/01/attached.jpg", lastModified: new Date("2026-01-01T00:00:00Z") },
      { key: "products/42/uploads/2026/08/10/recent.jpg", lastModified: new Date("2026-08-10T11:00:00Z") }
    ];

    const result = await service.cleanupUnattachedProductUploads(
      new Set(["products/42/uploads/2026/01/01/attached.jpg"]),
      new Date("2026-08-10T12:00:00Z")
    );

    expect(result).toEqual({ inspected: 3, deleted: 1 });
    expect(provider.deletedKeys).toEqual(["products/42/uploads/2026/01/01/orphan.jpg"]);
  });
});
