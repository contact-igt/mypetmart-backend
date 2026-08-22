import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ProductFeature } from "../../database/tables/ProductFeatureTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { formatFeatureDTO } from "./product.service.js";
import { InvalidProductDataError, ProductFeatureNotFoundError, ProductNotFoundError } from "./product.errors.js";
import type { CreateFeatureInput, ProductFeatureJSON, UpdateFeatureInput } from "./product.types.js";

export class ProductFeatureService {
  // Create Feature for a Product
  static async createFeature(productId: number, input: CreateFeatureInput): Promise<ProductFeatureJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    return await sequelize.transaction(async (t) => {
      const featureId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productFeatures, t);

      const feature = await ProductFeature.create(
        {
          id: featureId,
          product_id: productId,
          label: input.label,
          display_order: input.displayOrder ?? featureId
        },
        { transaction: t }
      );

      return formatFeatureDTO(feature);
    });
  }

  // Update Feature
  static async updateFeature(productId: number, featureId: number, input: UpdateFeatureInput): Promise<ProductFeatureJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const feature = await ProductFeature.findOne({ where: { id: featureId, product_id: productId } });
    if (!feature) {
      throw new ProductFeatureNotFoundError(featureId);
    }

    return await sequelize.transaction(async (t) => {
      const updates: Record<string, unknown> = {};
      if (input.label !== undefined) updates.label = input.label;
      if (input.displayOrder !== undefined) updates.display_order = input.displayOrder;

      await feature.update(updates, { transaction: t });

      return formatFeatureDTO(feature);
    });
  }

  // Delete Feature (hard delete — Features carry no downstream references, unlike Variants/Images)
  static async deleteFeature(productId: number, featureId: number): Promise<void> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const feature = await ProductFeature.findOne({ where: { id: featureId, product_id: productId } });
    if (!feature) {
      throw new ProductFeatureNotFoundError(featureId);
    }

    await feature.destroy();
  }

  // Reorder Features
  static async reorderFeatures(productId: number, orderedIds: number[]): Promise<ProductFeatureJSON[]> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const uniqueIds = Array.from(new Set(orderedIds));
    const features = await ProductFeature.findAll({ where: { product_id: productId } });
    const requestedIds = new Set(uniqueIds);

    if (features.length !== uniqueIds.length || features.some((feature) => !requestedIds.has(feature.id))) {
      throw new InvalidProductDataError("Feature reorder must include every record belonging to this Product exactly once.");
    }

    return await sequelize.transaction(async (t) => {
      for (let i = 0; i < uniqueIds.length; i++) {
        await ProductFeature.update({ display_order: i }, { where: { id: uniqueIds[i], product_id: productId }, transaction: t });
      }

      const reordered = await ProductFeature.findAll({
        where: { product_id: productId },
        order: [["display_order", "ASC"]],
        transaction: t
      });

      return reordered.map(formatFeatureDTO);
    });
  }
}
