import { Op } from "sequelize";
import type { Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { environmentConfig } from "../../config/environment.config.js";
import { sequelize } from "../../database/index.js";
import { Category } from "../../database/tables/CategoryTable/index.js";
import { ProductImage } from "../../database/tables/ProductImageTable/index.js";
import { objectStorageService } from "../../services/object-storage/object-storage.service.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ProductVariant } from "../../database/tables/ProductVariantTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { formatMoney, isCompareAtPriceValid } from "../../utils/product-money.js";
import { generateDuplicateSku, generateDuplicateSlug, isSkuReservedBy, normalizeAndValidateSku, reserveSku } from "./catalog-sku.service.js";
import {
  InvalidProductDataError,
  ProductCategoryInvalidError,
  ProductLegacyTrashNotRestorableError,
  ProductNotDeletedError,
  ProductNotFoundError,
  ProductNotSellableError,
  ProductRestoreConflictError,
  ProductRestoreSkuConflictError,
  ProductRestoreSlugConflictError,
  ProductSkuConflictError,
  ProductSlugConflictError
} from "./product.errors.js";
import type { ProductError } from "./product.errors.js";
import type {
  AdminProductDetailJSON,
  AdminProductListItemJSON,
  AdminProductListQuery,
  AdminProductSummaryJSON,
  CreateProductInput,
  ProductImageJSON,
  ProductVariantJSON,
  StorefrontProductDetailJSON,
  StorefrontProductListItemJSON,
  StorefrontProductListQuery,
  UpdateProductInput
} from "./product.types.js";
import { slugify } from "./product.validation.js";

const DEVELOPMENT_SAFE_TRASH_CUTOFF = new Date("2026-08-11T14:00:00.000Z");
const SAFE_TRASH_CUTOFF = environmentConfig.PRODUCT_SAFE_TRASH_CUTOFF
  ? new Date(environmentConfig.PRODUCT_SAFE_TRASH_CUTOFF)
  : DEVELOPMENT_SAFE_TRASH_CUTOFF;

function isLegacyTrash(product: Product): boolean {
  return product.deleted_at !== null && product.deleted_at.getTime() < SAFE_TRASH_CUTOFF.getTime();
}

type ProductRestoreEligibility =
  | { restorable: true; blockedBy: null; variants: ProductVariant[]; images: ProductImage[] }
  | { restorable: false; blockedBy: ProductError; variants: ProductVariant[]; images: ProductImage[] };

async function evaluateProductRestoreEligibility(product: Product): Promise<ProductRestoreEligibility> {
  if (!product.deleted_at) {
    return { restorable: false, blockedBy: new ProductNotDeletedError(product.id), variants: [], images: [] };
  }
  if (isLegacyTrash(product)) {
    return { restorable: false, blockedBy: new ProductLegacyTrashNotRestorableError(product.id), variants: [], images: [] };
  }

  const [variants, images, category, slugConflict] = await Promise.all([
    ProductVariant.findAll({ paranoid: false, where: { product_id: product.id } }),
    ProductImage.findAll({ paranoid: false, where: { product_id: product.id } }),
    Category.findByPk(product.category_id, { paranoid: false }),
    Product.findOne({ paranoid: false, where: { slug: product.slug, id: { [Op.ne]: product.id } } })
  ]);

  if (!category) {
    return {
      restorable: false,
      blockedBy: new ProductCategoryInvalidError(`Product '${product.id}' references a Category that no longer exists.`),
      variants,
      images
    };
  }
  if (slugConflict) {
    return { restorable: false, blockedBy: new ProductRestoreSlugConflictError(product.slug), variants, images };
  }
  if (!(await isSkuReservedBy(product.sku, "product", product.id))) {
    return { restorable: false, blockedBy: new ProductRestoreSkuConflictError(product.sku), variants, images };
  }
  for (const variant of variants) {
    if (!(await isSkuReservedBy(variant.sku, "variant", variant.id))) {
      return { restorable: false, blockedBy: new ProductRestoreSkuConflictError(variant.sku), variants, images };
    }
  }
  // Media Gallery-linked images (r2_key null, media_asset_id set) do not own
  // a "products/{id}/..." R2 key of their own, so they cannot be checked via
  // productImageObjectExists — their object's continued existence is instead
  // guaranteed by the Media Asset FK's ON DELETE RESTRICT (a referenced
  // Media Asset can never be deleted while this row exists).
  for (const image of images.filter((item) => item.deleted_at === null && item.r2_key !== null)) {
    try {
      if (!(await objectStorageService.productImageObjectExists(product.id, image.r2_key!))) {
        return {
          restorable: false,
          blockedBy: new ProductRestoreConflictError(`Product image '${image.id}' is unavailable in Cloudflare R2.`),
          variants,
          images
        };
      }
    } catch {
      return {
        restorable: false,
        blockedBy: new ProductRestoreConflictError(`Product image '${image.id}' availability could not be verified in Cloudflare R2.`),
        variants,
        images
      };
    }
  }

  return { restorable: true, blockedBy: null, variants, images };
}

// Helper: Refresh cached aggregates (price, compare_at_price, stock) on a Variant Product
export async function refreshVariantProductAggregates(productId: number, transaction?: Transaction): Promise<void> {
  const product = await Product.findByPk(productId, ...(transaction ? [{ transaction }] : []));
  if (!product || !product.has_variants) return;

  const activeVariants = await ProductVariant.findAll({
    where: {
      product_id: productId,
      active: true
    },
    order: [
      ["price", "ASC"],
      ["display_order", "ASC"],
      ["id", "ASC"]
    ],
    ...(transaction ? { transaction } : {})
  });

  if (activeVariants.length === 0) {
    // Zero active variants cache state
    await Product.update(
      {
        price: "0.00",
        compare_at_price: null,
        stock: 0
      },
      { where: { id: productId }, ...(transaction ? { transaction } : {}) }
    );
    return;
  }

  const minVariant = activeVariants[0];
  if (!minVariant) return;
  const totalStock = activeVariants.reduce((sum, v) => sum + v.stock, 0);

  await Product.update(
    {
      price: formatMoney(minVariant.price),
      compare_at_price: minVariant.compare_at_price ? formatMoney(minVariant.compare_at_price) : null,
      stock: totalStock
    },
    { where: { id: productId }, ...(transaction ? { transaction } : {}) }
  );
}

// Helper: Assert Category & Product Pet Type compatibility
export function validatePetTypeCompatibility(categoryPetType: string, productPetType: string): void {
  if (categoryPetType === "dog" && productPetType === "cat") {
    throw new ProductCategoryInvalidError("Dog category cannot contain cat products.");
  }
  if (categoryPetType === "cat" && productPetType === "dog") {
    throw new ProductCategoryInvalidError("Cat category cannot contain dog products.");
  }
}

// Helper: Validate sellability (pricing, active variants) for product activation.
// Shipping measurements are intentionally not required here — they are validated
// independently at shipment-creation time in ShipmentModels/shipment.service.ts.
export async function validateShippingReadiness(product: Product, transaction?: Transaction): Promise<void> {
  if (product.has_variants) {
    const activeVariants = await ProductVariant.findAll({
      where: { product_id: product.id, active: true },
      ...(transaction ? { transaction } : {})
    });

    if (activeVariants.length === 0) {
      throw new ProductNotSellableError("A variant product must have at least one active Variant before activation.");
    }

    for (const variant of activeVariants) {
      if (parseFloat(variant.price) <= 0) {
        throw new ProductNotSellableError(`Variant '${variant.name}' (SKU: ${variant.sku}) must have a positive selling price before activation.`);
      }
    }
  } else {
    if (parseFloat(product.price) <= 0) {
      throw new ProductNotSellableError("A simple product must have a positive selling price before activation.");
    }
  }
}

export async function validateProductActivationReadiness(product: Product, transaction?: Transaction): Promise<void> {
  const category = await Category.findByPk(product.category_id, {
    ...(transaction ? { transaction } : {})
  });
  if (!category || !category.active) {
    throw new ProductCategoryInvalidError("Product cannot be activated because its Category is inactive or deleted.");
  }
  validatePetTypeCompatibility(category.pet_type, product.pet_type);
  await validateShippingReadiness(product, transaction);
}

// Helper: Format image DTO. A Media Gallery-linked image (media_asset_id
// set) has no r2_key of its own — see the product_images.r2_key comment in
// schema-definition.ts — so its already-resolved, denormalized `url` column
// (copied from the Media Asset at attach time) is used as-is instead of
// re-deriving a public URL from a null key.
export function formatImageDTO(img: ProductImage, includeR2Key = false): ProductImageJSON {
  return {
    id: img.id,
    ...(includeR2Key && img.r2_key ? { r2Key: img.r2_key } : {}),
    mediaAssetId: img.media_asset_id,
    url: (img.r2_key ? objectStorageService.getPublicUrl(img.r2_key) : undefined) ?? img.url,
    alt: img.alt,
    contentType: img.content_type,
    sizeBytes: img.size_bytes,
    width: img.width,
    height: img.height,
    sortOrder: img.sort_order,
    isPrimary: img.is_primary
  };
}

// Helper: Format variant DTO
export function formatVariantDTO(v: ProductVariant): ProductVariantJSON {
  return {
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
  };
}

export class ProductService {
  // Storefront Product List
  static async listStorefrontProducts(query: StorefrontProductListQuery): Promise<{
    items: StorefrontProductListItemJSON[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const whereClause: Record<string, unknown> = {
      status: "active"
    };

    if (query.petType) {
      whereClause.pet_type = query.petType;
    }

    if (query.featured) {
      whereClause.featured = true;
    }

    if (query.search) {
      const term = `%${query.search.trim()}%`;
      whereClause[Op.or as unknown as string] = [
        { name: { [Op.like]: term } },
        { slug: { [Op.like]: term } },
        { sku: { [Op.like]: term } },
        { brand: { [Op.like]: term } }
      ];
    }

    const categoryInclude: Record<string, unknown> = {
      model: Category,
      as: "category",
      where: { active: true },
      attributes: ["id", "name", "slug", "pet_type"]
    };

    if (query.category) {
      if (/^\d+$/.test(query.category)) {
        categoryInclude.where = { ...(categoryInclude.where as object), id: Number(query.category) };
      } else {
        categoryInclude.where = { ...(categoryInclude.where as object), slug: query.category };
      }
    }

    let order: Array<[string, string]> = [["created_at", "DESC"], ["id", "DESC"]];
    if (query.sort === "price_asc") order = [["price", "ASC"], ["id", "ASC"]];
    if (query.sort === "price_desc") order = [["price", "DESC"], ["id", "ASC"]];
    if (query.sort === "name") order = [["name", "ASC"], ["id", "ASC"]];

    const { count, rows } = await Product.findAndCountAll({
      where: whereClause,
      include: [
        categoryInclude,
        {
          model: ProductImage,
          as: "images",
          where: { is_primary: true },
          required: false
        }
      ],
      order,
      limit: pageSize,
      offset,
      distinct: true
    });

    const items: StorefrontProductListItemJSON[] = rows.map((p) => {
      const primaryImg = p.images && p.images.length > 0 && p.images[0] ? formatImageDTO(p.images[0]) : null;
      return {
        id: p.id,
        name: p.name,
        slug: p.slug,
        brand: p.brand,
        petType: p.pet_type,
        price: formatMoney(p.price),
        compareAtPrice: p.compare_at_price ? formatMoney(p.compare_at_price) : null,
        stock: p.stock,
        hasVariants: p.has_variants,
        featured: p.featured,
        inStock: p.stock > 0,
        category: {
          id: p.category!.id,
          name: p.category!.name,
          slug: p.category!.slug,
          petType: p.category!.pet_type
        },
        primaryImage: primaryImg
      };
    });

    return {
      items,
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize)
    };
  }

  // Storefront Product Detail by Slug
  static async getStorefrontProductBySlug(slug: string): Promise<StorefrontProductDetailJSON> {
    const product = await Product.findOne({
      where: { slug, status: "active" },
      include: [
        {
          model: Category,
          as: "category",
          where: { active: true }
        },
        {
          model: ProductVariant,
          as: "variants",
          where: { active: true },
          required: false
        },
        {
          model: ProductImage,
          as: "images",
          required: false
        }
      ],
      order: [
        [{ model: ProductVariant, as: "variants" }, "display_order", "ASC"],
        [{ model: ProductImage, as: "images" }, "sort_order", "ASC"]
      ]
    });

    if (!product) {
      throw new ProductNotFoundError(slug);
    }

    const variants = (product.variants || []).map(formatVariantDTO);
    const images = (product.images || []).map((img) => formatImageDTO(img, false));
    const primaryImg = images.find((img) => img.isPrimary) || (images.length > 0 ? images[0] : null);

    return {
      id: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      brand: product.brand,
      description: product.description,
      petType: product.pet_type,
      price: formatMoney(product.price),
      compareAtPrice: product.compare_at_price ? formatMoney(product.compare_at_price) : null,
      stock: product.stock,
      hasVariants: product.has_variants,
      featured: product.featured,
      inStock: product.stock > 0,
      tags: (product.tags as string[]) || [],
      metaTitle: product.meta_title,
      metaDescription: product.meta_description,
      weightGrams: product.weight_grams,
      lengthCm: product.length_cm ? formatMoney(product.length_cm) : null,
      widthCm: product.width_cm ? formatMoney(product.width_cm) : null,
      heightCm: product.height_cm ? formatMoney(product.height_cm) : null,
      category: {
        id: product.category!.id,
        name: product.category!.name,
        slug: product.category!.slug,
        petType: product.category!.pet_type
      },
      primaryImage: primaryImg ?? null,
      variants,
      images
    };
  }

  // Admin Product List
  static async listAdminProducts(query: AdminProductListQuery): Promise<{
    items: AdminProductListItemJSON[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
  }> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize || 20));
    const offset = (page - 1) * pageSize;

    const whereClause: Record<string, unknown> = {};
    const deletedOnly = query.status === "deleted";

    if (query.categoryId) whereClause.category_id = query.categoryId;
    if (query.status && !deletedOnly) whereClause.status = query.status;
    if (deletedOnly) whereClause.deleted_at = { [Op.ne]: null };
    if (query.petType) whereClause.pet_type = query.petType;

    if (query.stockLevel === "out_of_stock") whereClause.stock = 0;
    if (query.stockLevel === "in_stock") whereClause.stock = { [Op.gt]: 0 };
    if (query.stockLevel === "low_stock") whereClause.stock = { [Op.between]: [1, 5] };

    if (query.search) {
      const term = `%${query.search.trim()}%`;
      whereClause[Op.or as unknown as string] = [
        { name: { [Op.like]: term } },
        { slug: { [Op.like]: term } },
        { sku: { [Op.like]: term } }
      ];
    }

    const sortCol = query.sort === "price" ? "price" : query.sort === "name" ? "name" : query.sort === "stock" ? "stock" : "created_at";
    const sortOrder = query.order === "ASC" ? "ASC" : "DESC";

    const { count, rows } = await Product.findAndCountAll({
      paranoid: !deletedOnly,
      where: whereClause,
      include: [
        { model: Category, as: "category", attributes: ["id", "name", "slug", "pet_type"], ...(deletedOnly ? { paranoid: false } : {}) },
        { model: ProductImage, as: "images", where: { is_primary: true }, required: false },
        { model: ProductVariant, as: "variants", attributes: ["id"], required: false }
      ],
      order: [[sortCol, sortOrder], ["id", sortOrder]],
      limit: pageSize,
      offset,
      distinct: true
    });

    const restoreEligibilityById = new Map<number, ProductRestoreEligibility>();
    if (deletedOnly) {
      const eligibility = await Promise.all(rows.map(async (product) => [product.id, await evaluateProductRestoreEligibility(product)] as const));
      eligibility.forEach(([productId, result]) => restoreEligibilityById.set(productId, result));
    }

    const items: AdminProductListItemJSON[] = rows.map((p) => {
      const primaryImg = p.images && p.images.length > 0 && p.images[0] ? formatImageDTO(p.images[0], true) : null;
      const eligibility = restoreEligibilityById.get(p.id);
      return {
        id: p.id,
        categoryId: p.category_id,
        name: p.name,
        slug: p.slug,
        sku: p.sku,
        petType: p.pet_type,
        status: p.status,
        price: formatMoney(p.price),
        compareAtPrice: p.compare_at_price ? formatMoney(p.compare_at_price) : null,
        stock: p.stock,
        hasVariants: p.has_variants,
        featured: p.featured,
        weightGrams: p.weight_grams,
        lengthCm: p.length_cm ? formatMoney(p.length_cm) : null,
        widthCm: p.width_cm ? formatMoney(p.width_cm) : null,
        heightCm: p.height_cm ? formatMoney(p.height_cm) : null,
        variantCount: p.variants ? p.variants.length : 0,
        category: {
          id: p.category!.id,
          name: p.category!.name,
          slug: p.category!.slug,
          petType: p.category!.pet_type
        },
        primaryImage: primaryImg,
        createdAt: p.created_at.toISOString(),
        updatedAt: p.updated_at.toISOString(),
        deletedAt: p.deleted_at?.toISOString() ?? null,
        restorable: eligibility?.restorable ?? false,
        restoreBlockedReason: eligibility?.blockedBy?.message ?? null
      };
    });

    return {
      items,
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize)
    };
  }

  // Admin Product Summary (single aggregate query; paranoid excludes soft-deleted rows)
  static async getAdminProductSummary(): Promise<AdminProductSummaryJSON> {
    const row = (await Product.findOne({
      attributes: [
        [sequelize.fn("COUNT", sequelize.col("id")), "total"],
        [sequelize.literal("SUM(CASE WHEN `status` = 'active' THEN 1 ELSE 0 END)"), "active"],
        [sequelize.literal("SUM(CASE WHEN `status` = 'draft' THEN 1 ELSE 0 END)"), "draft"],
        [sequelize.literal("SUM(CASE WHEN `status` = 'archived' THEN 1 ELSE 0 END)"), "archived"],
        [sequelize.literal("SUM(CASE WHEN `stock` = 0 THEN 1 ELSE 0 END)"), "outOfStock"]
      ],
      raw: true
    })) as unknown as Record<string, string | number | null> | null;

    return {
      total: Number(row?.total ?? 0),
      active: Number(row?.active ?? 0),
      draft: Number(row?.draft ?? 0),
      archived: Number(row?.archived ?? 0),
      outOfStock: Number(row?.outOfStock ?? 0)
    };
  }

  // Admin Product Detail by ID
  static async getAdminProductById(id: number, transaction?: Transaction): Promise<AdminProductDetailJSON> {
    const product = await Product.findByPk(id, {
      include: [
        { model: Category, as: "category", paranoid: false },
        { model: ProductVariant, as: "variants", required: false },
        { model: ProductImage, as: "images", required: false }
      ],
      order: [
        [{ model: ProductVariant, as: "variants" }, "display_order", "ASC"],
        [{ model: ProductImage, as: "images" }, "sort_order", "ASC"]
      ],
      ...(transaction ? { transaction } : {})
    });

    if (!product) {
      throw new ProductNotFoundError(id);
    }
    if (!product.category) {
      throw new ProductCategoryInvalidError(`Product '${id}' references a Category that no longer exists.`);
    }

    const variants = (product.variants || []).map(formatVariantDTO);
    const images = (product.images || []).map((img) => formatImageDTO(img, true));
    const primaryImg: typeof images[0] | null = images.find((img) => img.isPrimary) ?? (images.length > 0 ? images[0] ?? null : null);

    return {
      id: product.id,
      categoryId: product.category_id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      brand: product.brand,
      description: product.description,
      petType: product.pet_type,
      status: product.status,
      price: formatMoney(product.price),
      compareAtPrice: product.compare_at_price ? formatMoney(product.compare_at_price) : null,
      stock: product.stock,
      hasVariants: product.has_variants,
      featured: product.featured,
      weightGrams: product.weight_grams,
      lengthCm: product.length_cm ? formatMoney(product.length_cm) : null,
      widthCm: product.width_cm ? formatMoney(product.width_cm) : null,
      heightCm: product.height_cm ? formatMoney(product.height_cm) : null,
      variantCount: variants.length,
      tags: (product.tags as string[]) || [],
      metaTitle: product.meta_title,
      metaDescription: product.meta_description,
      category: {
        id: product.category.id,
        name: product.category.name,
        slug: product.category.slug,
        petType: product.category.pet_type
      },
      primaryImage: primaryImg,
      variants,
      images,
      createdAt: product.created_at.toISOString(),
      updatedAt: product.updated_at.toISOString(),
      deletedAt: product.deleted_at?.toISOString() ?? null,
      restorable: false,
      restoreBlockedReason: null
    };
  }

  // Create Product (Transactional)
  static async createProduct(input: CreateProductInput): Promise<AdminProductDetailJSON> {
    const category = await Category.findByPk(input.categoryId);
    if (!category) {
      throw new ProductCategoryInvalidError(`Category '${input.categoryId}' was not found.`);
    }

    const petType = input.petType ? input.petType : (category.pet_type !== "all" ? (category.pet_type as "dog" | "cat" | "all") : "all");
    validatePetTypeCompatibility(category.pet_type, petType);

    const initialSlug = slugify(input.name);
    const existingSlug = await Product.findOne({ where: { slug: initialSlug }, paranoid: false });
    if (existingSlug) {
      throw new ProductSlugConflictError(initialSlug);
    }

    const normalizedMasterSku = normalizeAndValidateSku(input.sku);

    if (input.hasVariants && input.variants && input.variants.length > 0) {
      const variantSkus = input.variants.map((v) => normalizeAndValidateSku(v.sku));
      const skuSet = new Set<string>([normalizedMasterSku]);
      for (const vSku of variantSkus) {
        if (skuSet.has(vSku)) {
          throw new ProductSkuConflictError(vSku);
        }
        skuSet.add(vSku);
      }
    }

    return await sequelize.transaction(async (t) => {
      const productId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.products, t);

      await reserveSku(normalizedMasterSku, "product", productId, t);

      const hasVariants = Boolean(input.hasVariants);
      const initialPrice = !hasVariants && input.price ? formatMoney(input.price) : "0.00";
      const initialComparePrice = !hasVariants && input.compareAtPrice ? formatMoney(input.compareAtPrice) : null;

      await Product.create(
        {
          id: productId,
          category_id: input.categoryId,
          name: input.name,
          slug: initialSlug,
          sku: normalizedMasterSku,
          brand: input.brand || null,
          description: input.description,
          pet_type: petType,
          status: input.status || "draft",
          price: initialPrice,
          compare_at_price: initialComparePrice,
          stock: !hasVariants && input.stock ? input.stock : 0,
          has_variants: hasVariants,
          featured: Boolean(input.featured),
          tags: input.tags || [],
          meta_title: input.metaTitle || null,
          meta_description: input.metaDescription || null,
          weight_grams: input.weightGrams || null,
          length_cm: input.lengthCm ? formatMoney(input.lengthCm) : null,
          width_cm: input.widthCm ? formatMoney(input.widthCm) : null,
          height_cm: input.heightCm ? formatMoney(input.heightCm) : null
        },
        { transaction: t }
      );

      if (hasVariants && input.variants && input.variants.length > 0) {
        const variantCount = input.variants.length;
        const variantIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productVariants, variantCount, t);

        for (let i = 0; i < variantCount; i++) {
          const vInput = input.variants[i]!;
          const vId = variantIds[i]!;
          const vSku = normalizeAndValidateSku(vInput.sku);

          await reserveSku(vSku, "variant", vId, t);

          await ProductVariant.create(
            {
              id: vId,
              product_id: productId,
              name: vInput.name,
              sku: vSku,
              price: formatMoney(vInput.price),
              compare_at_price: vInput.compareAtPrice ? formatMoney(vInput.compareAtPrice) : null,
              stock: vInput.stock ?? 0,
              active: vInput.active ?? true,
              display_order: vInput.displayOrder ?? i,
              weight_grams: vInput.weightGrams || null,
              length_cm: vInput.lengthCm ? formatMoney(vInput.lengthCm) : null,
              width_cm: vInput.widthCm ? formatMoney(vInput.widthCm) : null,
              height_cm: vInput.heightCm ? formatMoney(vInput.heightCm) : null
            },
            { transaction: t }
          );
        }

        await refreshVariantProductAggregates(productId, t);
      }

      const reloaded = await Product.findByPk(productId, { transaction: t });

      if (input.status === "active") {
        await validateProductActivationReadiness(reloaded!, t);
      }

      return await ProductService.getAdminProductById(productId, t);
    });
  }

  // Update Product Base Fields
  static async updateProduct(id: number, input: UpdateProductInput): Promise<AdminProductDetailJSON> {
    const product = await Product.findByPk(id);
    if (!product) {
      throw new ProductNotFoundError(id);
    }

    const cachedFieldMutationRequested = input.price !== undefined || input.compareAtPrice !== undefined || input.stock !== undefined;
    if (product.has_variants && cachedFieldMutationRequested) {
      throw new InvalidProductDataError("Variant product price, compareAtPrice, and stock are derived from active variants and cannot be updated directly.");
    }

    if (!product.has_variants && cachedFieldMutationRequested) {
      const targetPrice = input.price ?? formatMoney(product.price);
      const targetCompareAtPrice = input.compareAtPrice !== undefined ? input.compareAtPrice : product.compare_at_price;
      if (!isCompareAtPriceValid(targetPrice, targetCompareAtPrice)) {
        throw new InvalidProductDataError("compareAtPrice must be greater than or equal to price for a simple product.");
      }
    }

    if (input.categoryId !== undefined || input.petType !== undefined) {
      const targetCatId = input.categoryId ?? product.category_id;
      const category = await Category.findByPk(targetCatId);
      if (!category) {
        throw new ProductCategoryInvalidError(`Category '${targetCatId}' was not found.`);
      }
      const targetPetType = input.petType ?? product.pet_type;
      validatePetTypeCompatibility(category.pet_type, targetPetType);
    }

    return await sequelize.transaction(async (t) => {
      const updates: Record<string, unknown> = {};

      if (input.name !== undefined) updates.name = input.name;
      if (input.brand !== undefined) updates.brand = input.brand || null;
      if (input.description !== undefined) updates.description = input.description;
      if (input.categoryId !== undefined) updates.category_id = input.categoryId;
      if (input.petType !== undefined) updates.pet_type = input.petType;
      if (input.price !== undefined) updates.price = input.price;
      if (input.compareAtPrice !== undefined) updates.compare_at_price = input.compareAtPrice;
      if (input.stock !== undefined) updates.stock = input.stock;
      if (input.featured !== undefined) updates.featured = input.featured;
      if (input.tags !== undefined) updates.tags = input.tags;
      if (input.metaTitle !== undefined) updates.meta_title = input.metaTitle;
      if (input.metaDescription !== undefined) updates.meta_description = input.metaDescription;

      if (input.weightGrams !== undefined) updates.weight_grams = input.weightGrams;
      if (input.lengthCm !== undefined) updates.length_cm = input.lengthCm ? formatMoney(input.lengthCm) : null;
      if (input.widthCm !== undefined) updates.width_cm = input.widthCm ? formatMoney(input.widthCm) : null;
      if (input.heightCm !== undefined) updates.height_cm = input.heightCm ? formatMoney(input.heightCm) : null;

      if (input.sku !== undefined) {
        const newSku = normalizeAndValidateSku(input.sku);
        if (newSku !== product.sku) {
          await reserveSku(newSku, "product", id, t);
          updates.sku = newSku;
        }
      }

      await product.update(updates, { transaction: t });

      if (product.status === "active") {
        await validateProductActivationReadiness(product, t);
      }

      return await ProductService.getAdminProductById(id, t);
    });
  }

  // Update Product Status
  static async updateProductStatus(id: number, status: "draft" | "active" | "archived"): Promise<AdminProductDetailJSON> {
    const product = await Product.findByPk(id);
    if (!product) {
      throw new ProductNotFoundError(id);
    }

    if (status === "active") {
      await validateProductActivationReadiness(product);
    }

    await product.update({ status });
    return await ProductService.getAdminProductById(id);
  }

  // Soft Delete Product
  static async deleteProduct(id: number): Promise<void> {
    const product = await Product.findByPk(id);
    if (!product) {
      throw new ProductNotFoundError(id);
    }

    await product.destroy();
  }

  static async restoreProduct(id: number): Promise<AdminProductDetailJSON> {
    const product = await Product.findByPk(id, { paranoid: false });
    if (!product) throw new ProductNotFoundError(id);
    if (!product.deleted_at) throw new ProductNotDeletedError(id);

    const eligibility = await evaluateProductRestoreEligibility(product);
    if (!eligibility.restorable) throw eligibility.blockedBy;
    const allVariants = eligibility.variants;

    return await sequelize.transaction(async (t) => {
      const locked = await Product.findByPk(id, { paranoid: false, transaction: t, lock: true });
      if (!locked) throw new ProductNotFoundError(id);
      if (!locked.deleted_at) throw new ProductNotDeletedError(id);

      const category = await Category.findByPk(locked.category_id, { paranoid: false, transaction: t });
      if (!category) {
        throw new ProductCategoryInvalidError(`Product '${id}' references a Category that no longer exists.`);
      }

      const slugConflict = await Product.findOne({
        paranoid: false,
        where: { slug: locked.slug, id: { [Op.ne]: id } },
        transaction: t
      });
      if (slugConflict) throw new ProductRestoreSlugConflictError(locked.slug);

      if (!(await isSkuReservedBy(locked.sku, "product", id, t))) {
        throw new ProductRestoreSkuConflictError(locked.sku);
      }
      for (const variant of allVariants) {
        if (!(await isSkuReservedBy(variant.sku, "variant", variant.id, t))) {
          throw new ProductRestoreSkuConflictError(variant.sku);
        }
      }

      await locked.restore({ transaction: t });
      await locked.update({ status: "draft" }, { transaction: t });
      return await ProductService.getAdminProductById(id, t);
    });
  }

  // Duplicate Product
  static async duplicateProduct(id: number): Promise<AdminProductDetailJSON> {
    const source = await Product.findByPk(id, {
      include: [{ model: ProductVariant, as: "variants" }]
    });

    if (!source) {
      throw new ProductNotFoundError(id);
    }

    return await sequelize.transaction(async (t) => {
      const newProductId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.products, t);
      const newSlug = generateDuplicateSlug(source.slug, newProductId);
      const newMasterSku = generateDuplicateSku(source.sku, newProductId);

      await reserveSku(newMasterSku, "product", newProductId, t);

      await Product.create(
        {
          id: newProductId,
          category_id: source.category_id,
          name: `${source.name} Copy`,
          slug: newSlug,
          sku: newMasterSku,
          brand: source.brand,
          description: source.description,
          pet_type: source.pet_type,
          status: "draft",
          price: source.has_variants ? "0.00" : formatMoney(source.price),
          compare_at_price: source.has_variants ? null : source.compare_at_price ? formatMoney(source.compare_at_price) : null,
          stock: 0,
          has_variants: source.has_variants,
          featured: false,
          tags: source.tags,
          meta_title: source.meta_title,
          meta_description: source.meta_description,
          weight_grams: source.weight_grams,
          length_cm: source.length_cm,
          width_cm: source.width_cm,
          height_cm: source.height_cm
        },
        { transaction: t }
      );

      if (source.has_variants && source.variants && source.variants.length > 0) {
        const variantCount = source.variants.length;
        const variantIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productVariants, variantCount, t);

        for (let i = 0; i < variantCount; i++) {
          const v = source.variants[i]!;
          const newVarId = variantIds[i]!;
          const newVarSku = generateDuplicateSku(v.sku, newVarId);

          await reserveSku(newVarSku, "variant", newVarId, t);

          await ProductVariant.create(
            {
              id: newVarId,
              product_id: newProductId,
              name: v.name,
              sku: newVarSku,
              price: formatMoney(v.price),
              compare_at_price: v.compare_at_price ? formatMoney(v.compare_at_price) : null,
              stock: 0,
              active: v.active,
              display_order: v.display_order,
              weight_grams: v.weight_grams,
              length_cm: v.length_cm,
              width_cm: v.width_cm,
              height_cm: v.height_cm
            },
            { transaction: t }
          );
        }

        await refreshVariantProductAggregates(newProductId, t);
      }

      return await ProductService.getAdminProductById(newProductId, t);
    });
  }

  // Bulk Update Status
  static async bulkUpdateStatus(productIds: number[], status: "draft" | "active" | "archived"): Promise<number> {
    const uniqueIds = Array.from(new Set(productIds));
    const products = await Product.findAll({ where: { id: uniqueIds } });

    if (products.length !== uniqueIds.length) {
      throw new InvalidProductDataError("One or more Product IDs in bulk status payload do not exist.");
    }

    if (status === "active") {
      for (const p of products) {
        await validateProductActivationReadiness(p);
      }
    }

    return await sequelize.transaction(async (t) => {
      const [affected] = await Product.update({ status }, { where: { id: uniqueIds }, transaction: t });
      return affected;
    });
  }

  // Bulk Soft Delete
  static async bulkDeleteProducts(productIds: number[]): Promise<number> {
    const uniqueIds = Array.from(new Set(productIds));
    const products = await Product.findAll({ where: { id: uniqueIds } });

    if (products.length !== uniqueIds.length) {
      throw new InvalidProductDataError("One or more Product IDs in bulk delete payload do not exist.");
    }

    return await Product.destroy({ where: { id: uniqueIds } });
  }
}
