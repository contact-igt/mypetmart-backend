import { Op } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { MediaAsset } from "../../database/tables/MediaAssetTable/index.js";
import { ProductImage } from "../../database/tables/ProductImageTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { objectStorageService, type ObjectStorageService } from "../../services/object-storage/object-storage.service.js";
import { MediaAssetInUseError, MediaAssetNotFoundError } from "./media-asset.errors.js";
import type {
  CompleteMediaAssetUploadInput,
  MediaAssetJSON,
  MediaAssetListQuery,
  MediaAssetListResult,
  MediaAssetUsage,
  PresignMediaAssetUploadInput,
  UpdateMediaAssetInput
} from "./media-asset.types.js";
import type { MediaAssetUploadAuthorization } from "../../services/object-storage/object-storage.types.js";

function fileNameFromKey(key: string): string {
  return key.split("/").pop() ?? key;
}

async function getUsageCountMap(mediaAssetIds: number[]): Promise<Map<number, number>> {
  if (mediaAssetIds.length === 0) return new Map();

  const rows = (await ProductImage.findAll({
    attributes: ["media_asset_id", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
    where: { media_asset_id: mediaAssetIds },
    group: ["media_asset_id"],
    raw: true
  })) as unknown as Array<{ media_asset_id: number; count: string | number }>;

  return new Map(rows.map((row) => [Number(row.media_asset_id), Number(row.count ?? 0)]));
}

export class MediaAssetService {
  public static toJSON(asset: MediaAsset, usageCount: number, includeStorageKey = false): MediaAssetJSON {
    return {
      id: asset.id,
      fileName: asset.file_name,
      originalName: asset.original_name,
      ...(includeStorageKey ? { storageKey: asset.storage_key } : {}),
      url: objectStorageService.getPublicUrl(asset.storage_key) ?? asset.public_url,
      mimeType: asset.mime_type,
      fileSize: asset.file_size,
      width: asset.width,
      height: asset.height,
      altText: asset.alt_text,
      title: asset.title,
      uploadedBy: asset.uploaded_by,
      usageCount,
      createdAt: asset.created_at.toISOString(),
      updatedAt: asset.updated_at.toISOString()
    };
  }

  static async listAdminMediaAssets(query: MediaAssetListQuery): Promise<MediaAssetListResult> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 24));
    const offset = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      where[Op.or as unknown as string] = [
        { original_name: { [Op.like]: term } },
        { file_name: { [Op.like]: term } },
        { title: { [Op.like]: term } },
        { alt_text: { [Op.like]: term } }
      ];
    }

    const { count, rows } = await MediaAsset.findAndCountAll({
      where,
      order: [
        ["created_at", "DESC"],
        ["id", "DESC"]
      ],
      limit: pageSize,
      offset
    });

    const usageCountMap = await getUsageCountMap(rows.map((row) => row.id));
    const items = rows.map((row) => MediaAssetService.toJSON(row, usageCountMap.get(row.id) ?? 0, true));

    return {
      items,
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize)
    };
  }

  static async getAdminMediaAssetById(id: number): Promise<MediaAssetJSON> {
    const asset = await MediaAsset.findByPk(id);
    if (!asset) throw new MediaAssetNotFoundError(id);

    const usageCount = await ProductImage.count({ where: { media_asset_id: id } });
    return MediaAssetService.toJSON(asset, usageCount, true);
  }

  static async authorizeUpload(
    input: PresignMediaAssetUploadInput,
    storage: ObjectStorageService = objectStorageService
  ): Promise<MediaAssetUploadAuthorization> {
    return await storage.presignMediaAssetUpload(input);
  }

  static async completeUpload(
    input: CompleteMediaAssetUploadInput,
    uploadedBy: number,
    storage: ObjectStorageService = objectStorageService
  ): Promise<MediaAssetJSON> {
    const verified = await storage.verifyMediaAssetUpload(input.uploadToken);

    const existing = await MediaAsset.findOne({ where: { storage_key: verified.r2Key } });
    if (existing) {
      return MediaAssetService.toJSON(existing, await ProductImage.count({ where: { media_asset_id: existing.id } }), true);
    }

    return await sequelize.transaction(async (t) => {
      const assetId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.mediaAssets, t);

      const asset = await MediaAsset.create(
        {
          id: assetId,
          file_name: fileNameFromKey(verified.r2Key),
          original_name: input.originalFilename,
          storage_key: verified.r2Key,
          public_url: verified.publicUrl,
          mime_type: verified.contentType,
          file_size: verified.sizeBytes,
          width: input.width ?? null,
          height: input.height ?? null,
          alt_text: input.altText ?? null,
          title: input.title ?? null,
          uploaded_by: uploadedBy
        },
        { transaction: t }
      );

      return MediaAssetService.toJSON(asset, 0, true);
    });
  }

  static async updateMediaAsset(id: number, input: UpdateMediaAssetInput): Promise<MediaAssetJSON> {
    const asset = await MediaAsset.findByPk(id);
    if (!asset) throw new MediaAssetNotFoundError(id);

    const updates: Record<string, unknown> = {};
    if (input.altText !== undefined) updates.alt_text = input.altText;
    if (input.title !== undefined) updates.title = input.title;

    await asset.update(updates);

    const usageCount = await ProductImage.count({ where: { media_asset_id: id } });
    return MediaAssetService.toJSON(asset, usageCount, true);
  }

  static async getUsage(id: number): Promise<MediaAssetUsage> {
    const images = await ProductImage.findAll({ where: { media_asset_id: id }, attributes: ["product_id"] });
    const productIds = Array.from(new Set(images.map((image) => image.product_id)));
    return { usageCount: images.length, productIds };
  }

  static async deleteMediaAsset(id: number, storage: ObjectStorageService = objectStorageService): Promise<void> {
    const asset = await MediaAsset.findByPk(id);
    if (!asset) throw new MediaAssetNotFoundError(id);

    const usage = await MediaAssetService.getUsage(id);
    if (usage.usageCount > 0) {
      throw new MediaAssetInUseError(usage.usageCount, usage.productIds);
    }

    storage.ensureConfigured();
    const storageKey = asset.storage_key;
    await asset.destroy();
    await storage.deleteMediaAssetObject(storageKey);
  }
}
