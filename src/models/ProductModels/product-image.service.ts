import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { MediaAsset } from "../../database/tables/MediaAssetTable/index.js";
import { ProductImage } from "../../database/tables/ProductImageTable/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { MediaAssetNotFoundError } from "../MediaModels/media-asset.errors.js";
import { objectStorageService, type ObjectStorageService } from "../../services/object-storage/object-storage.service.js";
import { logger } from "../../utils/logger.js";
import { InvalidProductDataError, ProductImageMediaTypeNotAllowedError, ProductImageNotFoundError, ProductNotFoundError } from "./product.errors.js";
import { formatImageDTO } from "./product.service.js";
import type {
  AttachImageFromMediaAssetInput,
  AttachImageInput,
  CompleteProductImageUploadInput,
  PresignProductImageInput,
  ProductImageJSON,
  UpdateImageInput
} from "./product.types.js";

export class ProductImageService {
  static async authorizeUpload(
    productId: number,
    input: PresignProductImageInput,
    storage: ObjectStorageService = objectStorageService
  ) {
    const product = await Product.findByPk(productId);
    if (!product) throw new ProductNotFoundError(productId);
    return await storage.presignProductImageUpload(productId, input);
  }

  static async completeUpload(
    productId: number,
    input: CompleteProductImageUploadInput,
    storage: ObjectStorageService = objectStorageService
  ): Promise<ProductImageJSON> {
    const product = await Product.findByPk(productId);
    if (!product) throw new ProductNotFoundError(productId);

    const verified = await storage.verifyProductImageUpload(productId, input.uploadToken);
    const existing = await ProductImage.findOne({ where: { r2_key: verified.r2Key } });
    if (existing) {
      if (existing.product_id !== productId) {
        throw new InvalidProductDataError("The verified image object is already attached to another product.");
      }
      return formatImageDTO(existing, true);
    }

    return await ProductImageService.attachImage(productId, {
      r2Key: verified.r2Key,
      url: verified.publicUrl,
      alt: input.alt,
      contentType: verified.contentType,
      sizeBytes: verified.sizeBytes,
      ...(input.width !== undefined ? { width: input.width } : {}),
      ...(input.height !== undefined ? { height: input.height } : {}),
      ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      ...(input.isPrimary !== undefined ? { isPrimary: input.isPrimary } : {})
    });
  }

  // Attach Image Metadata to Product
  static async attachImage(productId: number, input: AttachImageInput): Promise<ProductImageJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    return await sequelize.transaction(async (t) => {
      // Row lock product to prevent primary switch race conditions
      await Product.findByPk(productId, { transaction: t, lock: true });

      const existingCount = await ProductImage.count({
        where: { product_id: productId },
        transaction: t
      });

      const isPrimary = existingCount === 0 ? true : Boolean(input.isPrimary);

      if (isPrimary) {
        await ProductImage.update({ is_primary: false }, { where: { product_id: productId }, transaction: t });
      }

      const imageId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productImages, t);

      const image = await ProductImage.create(
        {
          id: imageId,
          product_id: productId,
          r2_key: input.r2Key,
          url: input.url,
          alt: input.alt,
          content_type: input.contentType,
          size_bytes: input.sizeBytes || null,
          width: input.width || null,
          height: input.height || null,
          sort_order: input.sortOrder ?? imageId,
          is_primary: isPrimary
        },
        { transaction: t }
      );

      return formatImageDTO(image, true);
    });
  }

  // Attach an existing Media Gallery asset to a Product without a new R2 upload.
  // The resulting row shares its underlying R2 object (and public url) with
  // every other Product that reuses the same Media Asset — see the
  // product_images.r2_key comment in schema-definition.ts. Only alt text,
  // ordering, and primary-image status are Product-specific.
  static async attachFromMediaAsset(productId: number, input: AttachImageFromMediaAssetInput): Promise<ProductImageJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const mediaAsset = await MediaAsset.findByPk(input.mediaAssetId);
    if (!mediaAsset) {
      throw new MediaAssetNotFoundError(input.mediaAssetId);
    }
    // ProductImage remains strictly image-only: reject a video Media Asset here
    // rather than trusting the Admin picker's client-side filtering alone.
    if (mediaAsset.media_type === "video") {
      throw new ProductImageMediaTypeNotAllowedError();
    }

    return await sequelize.transaction(async (t) => {
      // Row lock product to prevent primary switch race conditions
      await Product.findByPk(productId, { transaction: t, lock: true });

      const existingCount = await ProductImage.count({
        where: { product_id: productId },
        transaction: t
      });

      const isPrimary = existingCount === 0 ? true : Boolean(input.isPrimary);

      if (isPrimary) {
        await ProductImage.update({ is_primary: false }, { where: { product_id: productId }, transaction: t });
      }

      const imageId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productImages, t);
      const alt = input.alt?.trim() || mediaAsset.alt_text || mediaAsset.title || mediaAsset.original_name;

      const image = await ProductImage.create(
        {
          id: imageId,
          product_id: productId,
          media_asset_id: mediaAsset.id,
          r2_key: null,
          url: objectStorageService.getPublicUrl(mediaAsset.storage_key) ?? mediaAsset.public_url,
          alt,
          content_type: mediaAsset.mime_type,
          size_bytes: mediaAsset.file_size,
          width: mediaAsset.width,
          height: mediaAsset.height,
          sort_order: input.sortOrder ?? imageId,
          is_primary: isPrimary
        },
        { transaction: t }
      );

      return formatImageDTO(image, true);
    });
  }

  // Update Image Metadata
  static async updateImage(productId: number, imageId: number, input: UpdateImageInput): Promise<ProductImageJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const image = await ProductImage.findOne({
      where: { id: imageId, product_id: productId }
    });

    if (!image) {
      throw new ProductImageNotFoundError(imageId);
    }

    return await sequelize.transaction(async (t) => {
      // Row lock parent Product to serialize primary image updates for this Product
      await Product.findByPk(productId, { transaction: t, lock: true });

      const updates: Record<string, unknown> = {};
      if (input.alt !== undefined) updates.alt = input.alt;
      if (input.sortOrder !== undefined) updates.sort_order = input.sortOrder;

      if (input.isPrimary === true) {
        await ProductImage.update({ is_primary: false }, { where: { product_id: productId }, transaction: t });
        updates.is_primary = true;
      }

      await image.update(updates, { transaction: t });
      return formatImageDTO(image, true);
    });
  }

  // Delete Image Metadata (Soft Delete & Auto-promote next image if primary)
  static async deleteImage(
    productId: number,
    imageId: number,
    storage: ObjectStorageService = objectStorageService
  ): Promise<void> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const image = await ProductImage.findOne({
      where: { id: imageId, product_id: productId }
    });

    if (!image) {
      throw new ProductImageNotFoundError(imageId);
    }

    // A Media Gallery-linked image (r2_key null, media_asset_id set) does not
    // own its R2 object — it shares the Media Asset's object with every
    // other Product that reuses it, so deleting this attachment must never
    // delete the object itself. Only a directly-uploaded image (its own,
    // exclusively-owned r2_key) triggers R2 cleanup here.
    const objectKey = image.r2_key;
    if (objectKey) {
      storage.ensureConfigured();
    }

    await sequelize.transaction(async (t) => {
      await Product.findByPk(productId, { transaction: t, lock: true });

      const wasPrimary = image.is_primary;

      // Clear is_primary BEFORE destroying so the unique constraint isn't violated
      // when we promote the next image (paranoid delete keeps the row with is_primary=1)
      if (wasPrimary) {
        await image.update({ is_primary: false }, { transaction: t });
      }

      await image.destroy({ transaction: t });

      if (wasPrimary) {
        const nextImage = await ProductImage.findOne({
          where: { product_id: productId },
          order: [
            ["sort_order", "ASC"],
            ["id", "ASC"]
          ],
          transaction: t
        });

        if (nextImage) {
          await nextImage.update({ is_primary: true }, { transaction: t });
        }
      }
    });

    if (!objectKey) return;

    try {
      await storage.deleteProductImageObject(productId, objectKey);
    } catch (error) {
      logger.error(
        { err: error, productId, imageId, objectKey, cleanupPending: true },
        "Product image metadata was deleted but R2 object cleanup remains pending"
      );
      throw error;
    }
  }

  // Reorder Product Images
  static async reorderImages(productId: number, orderedIds: number[]): Promise<ProductImageJSON[]> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const uniqueIds = Array.from(new Set(orderedIds));
    const images = await ProductImage.findAll({ where: { product_id: productId } });
    const requestedIds = new Set(uniqueIds);

    if (images.length !== uniqueIds.length || images.some((image) => !requestedIds.has(image.id))) {
      throw new InvalidProductDataError("Image reorder must include every active record belonging to this Product exactly once.");
    }

    return await sequelize.transaction(async (t) => {
      for (let i = 0; i < uniqueIds.length; i++) {
        await ProductImage.update({ sort_order: i }, { where: { id: uniqueIds[i], product_id: productId }, transaction: t });
      }

      const reordered = await ProductImage.findAll({
        where: { product_id: productId },
        order: [["sort_order", "ASC"]],
        transaction: t
      });

      return reordered.map((img) => formatImageDTO(img, true));
    });
  }
}

