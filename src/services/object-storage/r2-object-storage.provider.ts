import {
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { environmentConfig } from "../../config/environment.config.js";
import { r2Config } from "../../config/r2.config.js";
import { logger } from "../../utils/logger.js";
import { R2NotConfiguredError, R2OperationFailedError } from "./object-storage.errors.js";
import type {
  ListedStoredObject,
  ObjectStorageProvider,
  PresignedPutRequest,
  PresignedPutResult,
  StoredObjectMetadata
} from "./object-storage.types.js";

type ProviderFailure = Error & {
  name: string;
  $metadata?: { httpStatusCode?: number };
};

function isNotFound(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const providerFailure = error as ProviderFailure;
  return providerFailure.name === "NotFound" || providerFailure.name === "NoSuchKey" || providerFailure.$metadata?.httpStatusCode === 404;
}

export class R2ObjectStorageProvider implements ObjectStorageProvider {
  readonly #client: S3Client;
  readonly #bucket: string;

  public constructor() {
    if (
      !r2Config.ready ||
      !r2Config.endpoint ||
      !r2Config.accessKeyId ||
      !environmentConfig.R2_SECRET_ACCESS_KEY ||
      !r2Config.bucket
    ) {
      throw new R2NotConfiguredError();
    }

    this.#bucket = r2Config.bucket;
    this.#client = new S3Client({
      region: "auto",
      endpoint: r2Config.endpoint,
      credentials: {
        accessKeyId: r2Config.accessKeyId,
        secretAccessKey: environmentConfig.R2_SECRET_ACCESS_KEY
      },
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED"
    });
  }

  public async createPresignedPut(request: PresignedPutRequest): Promise<PresignedPutResult> {
    try {
      const uploadUrl = await getSignedUrl(
        this.#client,
        new PutObjectCommand({
          Bucket: this.#bucket,
          Key: request.key,
          ContentType: request.contentType
        }),
        { expiresIn: request.expiresInSeconds }
      );
      return { uploadUrl };
    } catch (error) {
      logger.error({ err: error, operation: "presign", objectKey: request.key }, "Cloudflare R2 operation failed");
      throw new R2OperationFailedError("presign");
    }
  }

  public async headObject(key: string): Promise<StoredObjectMetadata | null> {
    try {
      const result = await this.#client.send(new HeadObjectCommand({ Bucket: this.#bucket, Key: key }));
      return {
        key,
        contentType: result.ContentType,
        sizeBytes: result.ContentLength,
        lastModified: result.LastModified
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      logger.error({ err: error, operation: "inspect", objectKey: key }, "Cloudflare R2 operation failed");
      throw new R2OperationFailedError("inspect");
    }
  }

  public async deleteObject(key: string): Promise<void> {
    try {
      await this.#client.send(new DeleteObjectCommand({ Bucket: this.#bucket, Key: key }));
    } catch (error) {
      if (isNotFound(error)) return;
      logger.error({ err: error, operation: "delete", objectKey: key }, "Cloudflare R2 operation failed");
      throw new R2OperationFailedError("delete");
    }
  }

  public async listObjects(prefix: string): Promise<ListedStoredObject[]> {
    const objects: ListedStoredObject[] = [];
    let continuationToken: string | undefined;

    try {
      do {
        const result = await this.#client.send(
          new ListObjectsV2Command({ Bucket: this.#bucket, Prefix: prefix, ContinuationToken: continuationToken })
        );
        for (const object of result.Contents ?? []) {
          if (!object.Key) continue;
          objects.push({ key: object.Key, lastModified: object.LastModified });
        }
        continuationToken = result.IsTruncated ? result.NextContinuationToken : undefined;
      } while (continuationToken);
      return objects;
    } catch (error) {
      logger.error({ err: error, operation: "list", prefix }, "Cloudflare R2 operation failed");
      throw new R2OperationFailedError("list");
    }
  }
}
