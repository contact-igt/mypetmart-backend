import { UniqueConstraintError, type Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Category, Product, ProductImage, Wishlist } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { formatImageDTO } from "../ProductModels/product.service.js";
import { ProductNotFoundError } from "../ProductModels/product.errors.js";
import { formatMoney } from "../../utils/product-money.js";
import type { ProductImageJSON } from "../ProductModels/product.types.js";
import { WishlistItemNotFoundError } from "./wishlist.errors.js";
import type { WishlistItemJSON, WishlistJSON, WishlistProductSummaryJSON } from "./wishlist.types.js";

async function getPrimaryImageDTO(productId: number, transaction?: Transaction): Promise<ProductImageJSON | null> {
  const image = await ProductImage.findOne({
    where: { product_id: productId },
    order: [
      ["is_primary", "DESC"],
      ["sort_order", "ASC"],
      ["id", "ASC"]
    ],
    ...(transaction ? { transaction } : {})
  });
  return image ? formatImageDTO(image) : null;
}

async function buildWishlistProductSummary(product: Product, transaction?: Transaction): Promise<WishlistProductSummaryJSON> {
  // paranoid:false so a Product/Category soft-deleted after being wishlisted still renders
  // (as unavailable) instead of the Wishlist row silently disappearing — mirrors Cart's
  // buildCartDTO precedent for the same reason.
  const category = await Category.findByPk(product.category_id, { paranoid: false, ...(transaction ? { transaction } : {}) });
  if (!category) {
    // Impossible under the FK (RESTRICT) unless data was corrupted out-of-band.
    throw new Error(`Product ${product.id} references missing category ${product.category_id}.`);
  }
  const primaryImage = await getPrimaryImageDTO(product.id, transaction);

  const inStock = product.stock > 0;
  const available = product.deleted_at === null && product.status === "active" && inStock;

  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    brand: product.brand,
    petType: product.pet_type,
    price: formatMoney(product.price),
    compareAtPrice: product.compare_at_price ? formatMoney(product.compare_at_price) : null,
    stock: product.stock,
    hasVariants: product.has_variants,
    featured: product.featured,
    inStock,
    available,
    category: {
      id: category.id,
      name: category.name,
      slug: category.slug,
      petType: category.pet_type
    },
    primaryImage
  };
}

async function buildWishlistDTO(userId: number, transaction?: Transaction): Promise<WishlistJSON> {
  const rows = await Wishlist.findAll({
    where: { user_id: userId },
    order: [["created_at", "DESC"], ["id", "DESC"]],
    ...(transaction ? { transaction } : {})
  });

  const items: WishlistItemJSON[] = [];
  for (const row of rows) {
    // paranoid:false so a Product soft-deleted after being wishlisted still renders
    // (as unavailable) instead of silently disappearing from the Wishlist.
    const product = await Product.findByPk(row.product_id, { paranoid: false, ...(transaction ? { transaction } : {}) });
    if (!product) {
      // Impossible under the FK (RESTRICT) unless data was corrupted out-of-band.
      throw new Error(`Wishlist item ${row.id} references missing product ${row.product_id}.`);
    }
    items.push({
      wishlistItemId: row.id,
      createdAt: row.created_at.toISOString(),
      product: await buildWishlistProductSummary(product, transaction)
    });
  }

  return { items };
}

export const WishlistService = {
  async getWishlist(userId: number): Promise<WishlistJSON> {
    return buildWishlistDTO(userId);
  },

  async addItem(userId: number, productId: number): Promise<{ wishlist: WishlistJSON; created: boolean }> {
    return sequelize.transaction(async (t) => {
      // paranoid:true (default) — a soft-deleted or nonexistent Product cannot be newly
      // wishlisted, mirroring Cart's ProductNotFoundError for the add path.
      const product = await Product.findByPk(productId, { transaction: t });
      if (!product) {
        throw new ProductNotFoundError(productId);
      }

      let created = false;
      const existing = await Wishlist.findOne({
        where: { user_id: userId, product_id: productId },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!existing) {
        const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.wishlists, t);
        try {
          await Wishlist.create({ id, user_id: userId, product_id: productId }, { transaction: t });
          created = true;
        } catch (error) {
          if (!(error instanceof UniqueConstraintError)) {
            throw error;
          }
          // Lost the race to a concurrent duplicate add; the unique (user_id, product_id)
          // constraint already guarantees only one row exists, so this is a safe no-op.
        }
      }

      return { wishlist: await buildWishlistDTO(userId, t), created };
    });
  },

  async removeItem(userId: number, productId: number): Promise<WishlistJSON> {
    return sequelize.transaction(async (t) => {
      const existing = await Wishlist.findOne({
        where: { user_id: userId, product_id: productId },
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!existing) {
        throw new WishlistItemNotFoundError(productId);
      }

      await existing.destroy({ transaction: t });
      return buildWishlistDTO(userId, t);
    });
  }
};
