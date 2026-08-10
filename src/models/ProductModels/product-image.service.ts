import { Op } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { ProductImage } from "../../database/tables/ProductImageTable/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { InvalidProductDataError, ProductImageNotFoundError, ProductNotFoundError } from "./product.errors.js";
import { formatImageDTO } from "./product.service.js";
import type { AttachImageInput, ProductImageJSON, UpdateImageInput } from "./product.types.js";

export class ProductImageService {
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
  static async deleteImage(productId: number, imageId: number): Promise<void> {
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
  }

  // Reorder Product Images
  static async reorderImages(productId: number, orderedIds: number[]): Promise<ProductImageJSON[]> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const uniqueIds = Array.from(new Set(orderedIds));
    const images = await ProductImage.findAll({
      where: { product_id: productId, id: { [Op.in]: uniqueIds } }
    });

    if (images.length !== uniqueIds.length) {
      throw new InvalidProductDataError("One or more image IDs do not belong to this product.");
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

