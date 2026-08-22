import { z } from "zod";

import { MEDIA_ASSET_TYPE_VALUES } from "../../constants/database.constants.js";
import { InvalidMediaAssetIdError } from "./media-asset.errors.js";

export function parseMediaAssetId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidMediaAssetIdError();
}

const positiveQueryInteger = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().positive()
);

const queryPageSize = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().min(1).max(100)
);

export const mediaAssetListQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  search: z.string().trim().max(190).optional(),
  type: z.enum(MEDIA_ASSET_TYPE_VALUES).optional()
});

export const presignMediaAssetUploadSchema = z.object({
  originalFilename: z
    .string()
    .trim()
    .min(1, "Original filename is required")
    .max(255)
    .refine(
      (value) => !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127),
      "Original filename contains invalid control characters"
    ),
  contentType: z.string().trim().toLowerCase().min(1).max(100),
  sizeBytes: z.number().int().positive()
});

export const completeMediaAssetUploadSchema = z.object({
  uploadToken: z.string().trim().min(32).max(4096),
  originalFilename: z.string().trim().min(1, "Original filename is required").max(255),
  altText: z.string().trim().max(255).nullable().optional(),
  title: z.string().trim().max(190).nullable().optional(),
  width: z.number().int().min(1).max(20_000).nullable().optional(),
  height: z.number().int().min(1).max(20_000).nullable().optional()
});

export const updateMediaAssetSchema = z.object({
  altText: z.string().trim().max(255).nullable().optional(),
  title: z.string().trim().max(190).nullable().optional()
});
