import type { Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { MediaAsset } from "../../database/tables/MediaAssetTable/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ProductContentBlock } from "../../database/tables/ProductContentBlockTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { formatAdminContentBlockDTO } from "./product.service.js";
import { MediaAssetNotFoundError } from "../MediaModels/media-asset.errors.js";
import { EmptyContentBlockError, InvalidProductDataError, ProductContentBlockNotFoundError, ProductNotFoundError } from "./product.errors.js";
import type { AdminProductContentBlockJSON, CreateContentBlockInput, UpdateContentBlockInput } from "./product.types.js";

async function assertMediaAssetExists(mediaAssetId: number, transaction?: Transaction): Promise<void> {
  const asset = await MediaAsset.findByPk(mediaAssetId, ...(transaction ? [{ transaction }] : []));
  if (!asset) {
    throw new MediaAssetNotFoundError(mediaAssetId);
  }
}

// Re-fetches with the `media` include so the returned DTO always carries
// resolved MediaAsset data (title/publicUrl/mediaType/etc), never a stale
// in-memory row missing its association.
async function reloadWithMedia(id: number, transaction?: Transaction): Promise<ProductContentBlock> {
  const block = await ProductContentBlock.findByPk(id, {
    include: [{ model: MediaAsset, as: "media" }],
    ...(transaction ? { transaction } : {})
  });
  if (!block) {
    throw new ProductContentBlockNotFoundError(id);
  }
  return block;
}

export class ProductContentBlockService {
  // Create Content Block for a Product
  static async createContentBlock(productId: number, input: CreateContentBlockInput): Promise<AdminProductContentBlockJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    return await sequelize.transaction(async (t) => {
      if (input.mediaAssetId != null) {
        await assertMediaAssetExists(input.mediaAssetId, t);
      }

      const blockId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productContentBlocks, t);

      await ProductContentBlock.create(
        {
          id: blockId,
          product_id: productId,
          media_asset_id: input.mediaAssetId ?? null,
          heading: input.heading || null,
          description: input.description || null,
          layout: input.layout ?? "media_left",
          display_order: input.displayOrder ?? blockId,
          active: input.active ?? true
        },
        { transaction: t }
      );

      const reloaded = await reloadWithMedia(blockId, t);
      return formatAdminContentBlockDTO(reloaded);
    });
  }

  // Update Content Block
  static async updateContentBlock(productId: number, blockId: number, input: UpdateContentBlockInput): Promise<AdminProductContentBlockJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const block = await ProductContentBlock.findOne({ where: { id: blockId, product_id: productId } });
    if (!block) {
      throw new ProductContentBlockNotFoundError(blockId);
    }

    return await sequelize.transaction(async (t) => {
      if (input.mediaAssetId !== undefined && input.mediaAssetId !== null) {
        await assertMediaAssetExists(input.mediaAssetId, t);
      }

      const updates: Record<string, unknown> = {};
      if (input.mediaAssetId !== undefined) updates.media_asset_id = input.mediaAssetId;
      if (input.heading !== undefined) updates.heading = input.heading || null;
      if (input.description !== undefined) updates.description = input.description || null;
      if (input.layout !== undefined) updates.layout = input.layout;
      if (input.displayOrder !== undefined) updates.display_order = input.displayOrder;
      if (input.active !== undefined) updates.active = input.active;

      const resultingMediaAssetId = "media_asset_id" in updates ? (updates.media_asset_id as number | null) : block.media_asset_id;
      const resultingHeading = "heading" in updates ? (updates.heading as string | null) : block.heading;
      const resultingDescription = "description" in updates ? (updates.description as string | null) : block.description;
      if (resultingMediaAssetId == null && !resultingHeading && !resultingDescription) {
        throw new EmptyContentBlockError();
      }

      await block.update(updates, { transaction: t });

      const reloaded = await reloadWithMedia(blockId, t);
      return formatAdminContentBlockDTO(reloaded);
    });
  }

  // Delete Content Block (hard delete — removes only the block row, never the
  // referenced MediaAsset or its R2 object; see CLAUDE.md Enhanced Product
  // Content §7)
  static async deleteContentBlock(productId: number, blockId: number): Promise<void> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const block = await ProductContentBlock.findOne({ where: { id: blockId, product_id: productId } });
    if (!block) {
      throw new ProductContentBlockNotFoundError(blockId);
    }

    await block.destroy();
  }

  // Reorder Content Blocks
  static async reorderContentBlocks(productId: number, orderedIds: number[]): Promise<AdminProductContentBlockJSON[]> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const uniqueIds = Array.from(new Set(orderedIds));
    const blocks = await ProductContentBlock.findAll({ where: { product_id: productId } });
    const requestedIds = new Set(uniqueIds);

    if (blocks.length !== uniqueIds.length || blocks.some((block) => !requestedIds.has(block.id))) {
      throw new InvalidProductDataError("Content block reorder must include every record belonging to this Product exactly once.");
    }

    return await sequelize.transaction(async (t) => {
      for (let i = 0; i < uniqueIds.length; i++) {
        await ProductContentBlock.update({ display_order: i }, { where: { id: uniqueIds[i], product_id: productId }, transaction: t });
      }

      const reordered = await ProductContentBlock.findAll({
        where: { product_id: productId },
        include: [{ model: MediaAsset, as: "media" }],
        order: [["display_order", "ASC"]],
        transaction: t
      });

      return reordered.map(formatAdminContentBlockDTO);
    });
  }
}
