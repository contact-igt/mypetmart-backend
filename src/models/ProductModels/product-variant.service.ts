import { Op } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ProductVariant } from "../../database/tables/ProductVariantTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { formatMoney } from "../../utils/product-money.js";
import { normalizeAndValidateSku, reserveSku } from "./catalog-sku.service.js";
import {
  InvalidProductDataError,
  LastActiveVariantError,
  ProductNotFoundError,
  ProductVariantNotFoundError
} from "./product.errors.js";
import { refreshVariantProductAggregates } from "./product.service.js";
import type { CreateVariantInput, ProductVariantJSON, UpdateVariantInput } from "./product.types.js";

export class ProductVariantService {
  // Create Variant for a Product
  static async createVariant(productId: number, input: CreateVariantInput): Promise<ProductVariantJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    if (!product.has_variants) {
      throw new InvalidProductDataError(`Product '${productId}' is a simple product and does not accept variants.`);
    }

    const normalizedSku = normalizeAndValidateSku(input.sku);

    return await sequelize.transaction(async (t) => {
      const variantId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.productVariants, t);

      await reserveSku(normalizedSku, "variant", variantId, t);

      const variant = await ProductVariant.create(
        {
          id: variantId,
          product_id: productId,
          name: input.name,
          sku: normalizedSku,
          price: formatMoney(input.price),
          compare_at_price: input.compareAtPrice ? formatMoney(input.compareAtPrice) : null,
          stock: input.stock ?? 0,
          active: input.active ?? true,
          display_order: input.displayOrder ?? variantId,
          weight_grams: input.weightGrams || null,
          length_cm: input.lengthCm ? formatMoney(input.lengthCm) : null,
          width_cm: input.widthCm ? formatMoney(input.widthCm) : null,
          height_cm: input.heightCm ? formatMoney(input.heightCm) : null
        },
        { transaction: t }
      );

      await refreshVariantProductAggregates(productId, t);

      return {
        id: variant.id,
        productId: variant.product_id,
        name: variant.name,
        sku: variant.sku,
        price: formatMoney(variant.price),
        compareAtPrice: variant.compare_at_price ? formatMoney(variant.compare_at_price) : null,
        stock: variant.stock,
        active: variant.active,
        displayOrder: variant.display_order,
        weightGrams: variant.weight_grams,
        lengthCm: variant.length_cm ? formatMoney(variant.length_cm) : null,
        widthCm: variant.width_cm ? formatMoney(variant.width_cm) : null,
        heightCm: variant.height_cm ? formatMoney(variant.height_cm) : null,
        createdAt: variant.created_at.toISOString(),
        updatedAt: variant.updated_at.toISOString()
      };
    });
  }

  // Update Variant
  static async updateVariant(productId: number, variantId: number, input: UpdateVariantInput): Promise<ProductVariantJSON> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const variant = await ProductVariant.findOne({
      where: { id: variantId, product_id: productId }
    });

    if (!variant) {
      throw new ProductVariantNotFoundError(variantId);
    }

    // Final active variant protection
    if (input.active === false && variant.active && product.status === "active") {
      const activeCount = await ProductVariant.count({
        where: { product_id: productId, active: true }
      });
      if (activeCount <= 1) {
        throw new LastActiveVariantError();
      }
    }

    return await sequelize.transaction(async (t) => {
      const updates: Record<string, unknown> = {};

      if (input.name !== undefined) updates.name = input.name;
      if (input.price !== undefined) updates.price = formatMoney(input.price);
      if (input.compareAtPrice !== undefined) updates.compare_at_price = input.compareAtPrice ? formatMoney(input.compareAtPrice) : null;
      if (input.stock !== undefined) updates.stock = input.stock;
      if (input.active !== undefined) updates.active = input.active;
      if (input.displayOrder !== undefined) updates.display_order = input.displayOrder;
      if (input.weightGrams !== undefined) updates.weight_grams = input.weightGrams;
      if (input.lengthCm !== undefined) updates.length_cm = input.lengthCm ? formatMoney(input.lengthCm) : null;
      if (input.widthCm !== undefined) updates.width_cm = input.widthCm ? formatMoney(input.widthCm) : null;
      if (input.heightCm !== undefined) updates.height_cm = input.heightCm ? formatMoney(input.heightCm) : null;

      if (input.sku !== undefined) {
        const newSku = normalizeAndValidateSku(input.sku);
        if (newSku !== variant.sku) {
          await reserveSku(newSku, "variant", variantId, t);
          updates.sku = newSku;
        }
      }

      await variant.update(updates, { transaction: t });

      await refreshVariantProductAggregates(productId, t);

      return {
        id: variant.id,
        productId: variant.product_id,
        name: variant.name,
        sku: variant.sku,
        price: formatMoney(variant.price),
        compareAtPrice: variant.compare_at_price ? formatMoney(variant.compare_at_price) : null,
        stock: variant.stock,
        active: variant.active,
        displayOrder: variant.display_order,
        weightGrams: variant.weight_grams,
        lengthCm: variant.length_cm ? formatMoney(variant.length_cm) : null,
        widthCm: variant.width_cm ? formatMoney(variant.width_cm) : null,
        heightCm: variant.height_cm ? formatMoney(variant.height_cm) : null,
        createdAt: variant.created_at.toISOString(),
        updatedAt: variant.updated_at.toISOString()
      };
    });
  }

  // Delete Variant (Soft Delete)
  static async deleteVariant(productId: number, variantId: number): Promise<void> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const variant = await ProductVariant.findOne({
      where: { id: variantId, product_id: productId }
    });

    if (!variant) {
      throw new ProductVariantNotFoundError(variantId);
    }

    // Final active variant protection
    if (variant.active && product.status === "active") {
      const activeCount = await ProductVariant.count({
        where: { product_id: productId, active: true }
      });
      if (activeCount <= 1) {
        throw new LastActiveVariantError();
      }
    }

    await sequelize.transaction(async (t) => {
      await variant.destroy({ transaction: t });
      await refreshVariantProductAggregates(productId, t);
    });
  }

  // Reorder Variants
  static async reorderVariants(productId: number, orderedIds: number[]): Promise<ProductVariantJSON[]> {
    const product = await Product.findByPk(productId);
    if (!product) {
      throw new ProductNotFoundError(productId);
    }

    const uniqueIds = Array.from(new Set(orderedIds));
    const variants = await ProductVariant.findAll({
      where: { product_id: productId, id: { [Op.in]: uniqueIds } }
    });

    if (variants.length !== uniqueIds.length) {
      throw new InvalidProductDataError("One or more Variant IDs do not belong to this product.");
    }

    return await sequelize.transaction(async (t) => {
      for (let i = 0; i < uniqueIds.length; i++) {
        await ProductVariant.update({ display_order: i }, { where: { id: uniqueIds[i], product_id: productId }, transaction: t });
      }

      const reordered = await ProductVariant.findAll({
        where: { product_id: productId },
        order: [["display_order", "ASC"]],
        transaction: t
      });

      return reordered.map((v) => ({
        id: v.id,
        productId: v.product_id,
        name: v.name,
        sku: v.sku,
        price: formatMoney(v.price),
        compareAtPrice: v.compare_at_price ? formatMoney(v.compare_at_price) : null,
        stock: v.stock,
        active: v.active,
        displayOrder: v.display_order,
        weightGrams: v.weight_grams,
        lengthCm: v.length_cm ? formatMoney(v.length_cm) : null,
        widthCm: v.width_cm ? formatMoney(v.width_cm) : null,
        heightCm: v.height_cm ? formatMoney(v.height_cm) : null,
        createdAt: v.created_at.toISOString(),
        updatedAt: v.updated_at.toISOString()
      }));
    });
  }
}

