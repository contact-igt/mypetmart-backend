import { Op } from "sequelize";
import type { Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { environmentConfig } from "../../config/environment.config.js";
import { sequelize } from "../../database/index.js";
import { Category } from "../../database/tables/CategoryTable/index.js";
import { MediaAsset } from "../../database/tables/MediaAssetTable/index.js";
import { ProductContentBlock } from "../../database/tables/ProductContentBlockTable/index.js";
import { ProductFaq } from "../../database/tables/ProductFaqTable/index.js";
import { ProductFeature } from "../../database/tables/ProductFeatureTable/index.js";
import { ProductImage } from "../../database/tables/ProductImageTable/index.js";
import { ProductMediaAssignment } from "../../database/tables/ProductMediaAssignmentTable/index.js";
import { ProductSpecification } from "../../database/tables/ProductSpecificationTable/index.js";
import { objectStorageService } from "../../services/object-storage/object-storage.service.js";
import { Product } from "../../database/tables/ProductTable/index.js";
import { ProductVariant } from "../../database/tables/ProductVariantTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { formatMoney, isCompareAtPriceValid } from "../../utils/product-money.js";
import { generateDuplicateSku, generateDuplicateSlug, isSkuReservedBy, normalizeAndValidateSku, reserveSku } from "./catalog-sku.service.js";
import { MediaAssetNotFoundError } from "../MediaModels/media-asset.errors.js";
import { computeReviewSummaries } from "../ReviewModels/review.service.js";
import type { ReviewSummaryJSON } from "../ReviewModels/review.types.js";
import {
  InvalidProductDataError,
  ProductCategoryInvalidError,
  ProductLegacyTrashNotRestorableError,
  ProductMediaAssignmentTypeNotAllowedError,
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
  AdminProductContentBlockJSON,
  AdminProductDetailJSON,
  AdminProductFaqJSON,
  AdminProductListItemJSON,
  AdminProductListQuery,
  AdminProductSpecificationJSON,
  AdminProductSummaryJSON,
  CreateProductInput,
  ProductContentBlockJSON,
  ProductFaqJSON,
  ProductFeatureJSON,
  ProductImageJSON,
  ProductMediaAssignmentJSON,
  ProductSpecificationJSON,
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

// Older catalog imports can contain the JSON column as serialized text rather
// than the array Sequelize normally returns. Normalize at the API boundary so
// every consumer, including the Admin edit form, receives the documented
// `string[]` contract.
function normalizeProductTags(value: unknown): string[] {
  let candidates: unknown[] = [];

  if (Array.isArray(value)) {
    candidates = value;
  } else if (typeof value === "string" && value.trim()) {
    const raw = value.trim();
    try {
      const parsed: unknown = JSON.parse(raw);
      candidates = Array.isArray(parsed) ? parsed : typeof parsed === "string" ? [parsed] : [];
    } catch {
      candidates = raw.split(",");
    }
  }

  return candidates
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim())
    .filter((tag, index, tags) => tag.length > 0 && tags.indexOf(tag) === index);
}

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

// Helper: Format feature DTO
export function formatFeatureDTO(f: ProductFeature): ProductFeatureJSON {
  return {
    id: f.id,
    productId: f.product_id,
    label: f.label,
    displayOrder: f.display_order,
    createdAt: f.created_at.toISOString(),
    updatedAt: f.updated_at.toISOString()
  };
}

// Helper: Format Specification DTO for Admin (includes id, so a row can be
// referenced for edit/delete/reorder).
export function formatAdminSpecificationDTO(s: ProductSpecification): AdminProductSpecificationJSON {
  return {
    id: s.id,
    label: s.label,
    value: s.value,
    displayOrder: s.display_order
  };
}

// Helper: Format Specification DTO for the Storefront — no internal id, matching
// the DTO boundary in CLAUDE.md Product Specifications §9.
export function formatSpecificationDTO(s: ProductSpecification): ProductSpecificationJSON {
  return {
    label: s.label,
    value: s.value,
    displayOrder: s.display_order
  };
}

// Helper: Format FAQ DTO for the Storefront — no internal id, matching the
// same DTO boundary as formatSpecificationDTO (storefront never needs to
// reference an individual FAQ row).
export function formatFaqDTO(f: ProductFaq): ProductFaqJSON {
  return {
    question: f.question,
    answer: f.answer,
    displayOrder: f.display_order
  };
}

// Helper: Format FAQ DTO for Admin — includes id, so a row can be referenced
// for edit/delete/reorder.
export function formatAdminFaqDTO(f: ProductFaq): AdminProductFaqJSON {
  return {
    id: f.id,
    question: f.question,
    answer: f.answer,
    displayOrder: f.display_order
  };
}

// Helper: Format Content Block DTO for Admin — includes id/mediaAssetId/active
// and the full safe media summary. `media` must be eager-loaded (see the
// `contentBlocks` include below) — this never re-queries.
export function formatAdminContentBlockDTO(b: ProductContentBlock): AdminProductContentBlockJSON {
  const asset = b.media ?? null;
  return {
    id: b.id,
    mediaAssetId: b.media_asset_id,
    heading: b.heading,
    description: b.description,
    layout: b.layout,
    displayOrder: b.display_order,
    active: b.active,
    media: asset
      ? {
          id: asset.id,
          publicUrl: objectStorageService.getPublicUrl(asset.storage_key) ?? asset.public_url,
          mediaType: asset.media_type,
          mimeType: asset.mime_type,
          title: asset.title,
          originalName: asset.original_name
        }
      : null
  };
}

// Helper: Format Content Block DTO for the Storefront — no internal
// id/mediaAssetId/active, and the media summary drops id/originalName too
// (see CLAUDE.md Enhanced Product Content §9 — never expose storageKey or
// internal storage metadata).
export function formatContentBlockDTO(b: ProductContentBlock): ProductContentBlockJSON {
  const asset = b.media ?? null;
  return {
    heading: b.heading,
    description: b.description,
    layout: b.layout,
    displayOrder: b.display_order,
    media: asset
      ? {
          publicUrl: objectStorageService.getPublicUrl(asset.storage_key) ?? asset.public_url,
          mediaType: asset.media_type,
          mimeType: asset.mime_type,
          title: asset.title
        }
      : null
  };
}

// Helper: Format Product media assignment DTO. mediaAsset must be eager-loaded
// (see the `mediaAssignments` include below) — this never re-queries.
export function formatMediaAssignmentDTO(a: ProductMediaAssignment): ProductMediaAssignmentJSON {
  const asset = a.mediaAsset!;
  return {
    id: a.id,
    mediaAssetId: a.media_asset_id,
    mediaRole: a.media_role,
    title: a.title,
    caption: a.caption,
    displayOrder: a.display_order,
    active: a.active,
    media: {
      id: asset.id,
      publicUrl: objectStorageService.getPublicUrl(asset.storage_key) ?? asset.public_url,
      mimeType: asset.mime_type,
      mediaType: asset.media_type,
      title: asset.title,
      originalName: asset.original_name
    }
  };
}

// Helper: Load a MediaAsset and assert it is a video — shared by createProduct's
// inline mediaAssignments and ProductMediaAssignmentService's standalone create.
export async function assertVideoMediaAsset(mediaAssetId: number, transaction?: Transaction): Promise<MediaAsset> {
  const asset = await MediaAsset.findByPk(mediaAssetId, ...(transaction ? [{ transaction }] : []));
  if (!asset) {
    throw new MediaAssetNotFoundError(mediaAssetId);
  }
  if (asset.media_type !== "video") {
    throw new ProductMediaAssignmentTypeNotAllowedError();
  }
  return asset;
}

// Helper: Format Storefront Product list item DTO. `category` (active) and
// `images` (primary only) must be eager-loaded — this never re-queries.
// Shared by the Storefront list endpoint and Related Products.
export function formatStorefrontListItemDTO(p: Product, rating?: ReviewSummaryJSON): StorefrontProductListItemJSON {
  const primaryImg = p.images && p.images.length > 0 && p.images[0] ? formatImageDTO(p.images[0]) : null;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    brand: p.brand,
    description: p.description,
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
    primaryImage: primaryImg,
    averageRating: rating?.averageRating ?? 0,
    reviewCount: rating?.reviewCount ?? 0
  };
}

const RELATED_PRODUCTS_LIMIT = 6;
const RELATED_PRODUCTS_CANDIDATE_POOL = 50;
const RELATED_PRODUCTS_PRICE_BAND = 0.3;

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

    // One grouped aggregate query for the whole page — never one Review query
    // per Product (see computeReviewSummaries in ReviewModels/review.service.ts).
    const ratingByProductId = await computeReviewSummaries(rows.map((p) => p.id));
    const items: StorefrontProductListItemJSON[] = rows.map((p) => formatStorefrontListItemDTO(p, ratingByProductId.get(p.id)));

    return {
      items,
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize)
    };
  }

  // Related Products (V1 — automatic, no manual admin mapping/override yet).
  // Ranks candidates sharing category/brand/tags/price band with `product`,
  // then tops up with other active Products if fewer than `limit` matched, so
  // the section never renders empty placeholders. Two bounded queries total
  // (candidates + optional top-up) — no N+1, and unrelated to Shop/Home/
  // Category listing queries.
  static async getRelatedProducts(product: Product, limit = RELATED_PRODUCTS_LIMIT): Promise<StorefrontProductListItemJSON[]> {
    const currentTags = normalizeProductTags(product.tags);
    const currentPrice = parseFloat(product.price);

    const orConditions: Record<string, unknown>[] = [{ category_id: product.category_id }];
    if (product.brand) {
      orConditions.push({ brand: product.brand });
    }

    const candidates = await Product.findAll({
      where: {
        id: { [Op.ne]: product.id },
        status: "active",
        [Op.or]: orConditions
      },
      include: [
        { model: Category, as: "category", where: { active: true }, attributes: ["id", "name", "slug", "pet_type"] },
        { model: ProductImage, as: "images", where: { is_primary: true }, required: false }
      ],
      order: [["created_at", "DESC"]],
      limit: RELATED_PRODUCTS_CANDIDATE_POOL
    });

    const scored = candidates.map((p) => {
      let score = 0;
      if (p.category_id === product.category_id) score += 50;
      if (product.brand && p.brand === product.brand) score += 30;
      const pTags = normalizeProductTags(p.tags);
      score += pTags.filter((tag) => currentTags.includes(tag)).length * 10;
      if (currentPrice > 0) {
        const candidatePrice = parseFloat(p.price);
        if (Math.abs(candidatePrice - currentPrice) / currentPrice <= RELATED_PRODUCTS_PRICE_BAND) score += 10;
      }
      return { product: p, score };
    });

    scored.sort((a, b) => b.score - a.score || b.product.created_at.getTime() - a.product.created_at.getTime());
    const picked = scored.slice(0, limit);

    if (picked.length < limit) {
      const excludeIds = [product.id, ...picked.map((item) => item.product.id)];
      const fallback = await Product.findAll({
        where: { id: { [Op.notIn]: excludeIds }, status: "active" },
        include: [
          { model: Category, as: "category", where: { active: true }, attributes: ["id", "name", "slug", "pet_type"] },
          { model: ProductImage, as: "images", where: { is_primary: true }, required: false }
        ],
        order: [["created_at", "DESC"]],
        limit: limit - picked.length
      });
      picked.push(...fallback.map((p) => ({ product: p, score: 0 })));
    }

    const ratingByProductId = await computeReviewSummaries(picked.map(({ product: p }) => p.id));
    return picked.map(({ product: p }) => formatStorefrontListItemDTO(p, ratingByProductId.get(p.id)));
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
        },
        {
          model: ProductFeature,
          as: "features",
          required: false
        },
        {
          model: ProductSpecification,
          as: "specifications",
          required: false
        },
        {
          model: ProductContentBlock,
          as: "contentBlocks",
          where: { active: true },
          required: false,
          include: [{ model: MediaAsset, as: "media" }]
        },
        {
          model: ProductMediaAssignment,
          as: "mediaAssignments",
          where: { active: true },
          required: false,
          include: [{ model: MediaAsset, as: "mediaAsset" }]
        },
        {
          model: ProductFaq,
          as: "faqs",
          required: false
        }
      ],
      order: [
        [{ model: ProductVariant, as: "variants" }, "display_order", "ASC"],
        [{ model: ProductImage, as: "images" }, "sort_order", "ASC"],
        [{ model: ProductFeature, as: "features" }, "display_order", "ASC"],
        [{ model: ProductFeature, as: "features" }, "id", "ASC"],
        [{ model: ProductSpecification, as: "specifications" }, "display_order", "ASC"],
        [{ model: ProductSpecification, as: "specifications" }, "id", "ASC"],
        [{ model: ProductContentBlock, as: "contentBlocks" }, "display_order", "ASC"],
        [{ model: ProductContentBlock, as: "contentBlocks" }, "id", "ASC"],
        [{ model: ProductMediaAssignment, as: "mediaAssignments" }, "display_order", "ASC"],
        [{ model: ProductMediaAssignment, as: "mediaAssignments" }, "id", "ASC"],
        [{ model: ProductFaq, as: "faqs" }, "display_order", "ASC"],
        [{ model: ProductFaq, as: "faqs" }, "id", "ASC"]
      ]
    });

    if (!product) {
      throw new ProductNotFoundError(slug);
    }

    const variants = (product.variants || []).map(formatVariantDTO);
    const images = (product.images || []).map((img) => formatImageDTO(img, false));
    const features = (product.features || []).map(formatFeatureDTO);
    const specifications = (product.specifications || []).map(formatSpecificationDTO);
    const contentBlocks = (product.contentBlocks || []).map(formatContentBlockDTO);
    const faqs = (product.faqs || []).map(formatFaqDTO);
    const mediaAssignments = (product.mediaAssignments || []).map(formatMediaAssignmentDTO);
    const productVideos = mediaAssignments.filter((a) => a.mediaRole === "product_video");
    const testimonialVideos = mediaAssignments.filter((a) => a.mediaRole === "testimonial_video");
    const primaryImg = images.find((img) => img.isPrimary) || (images.length > 0 ? images[0] : null);
    const relatedProducts = await ProductService.getRelatedProducts(product);
    const rating = (await computeReviewSummaries([product.id])).get(product.id);

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
      tags: normalizeProductTags(product.tags),
      metaTitle: product.meta_title,
      metaDescription: product.meta_description,
      weightGrams: product.weight_grams,
      lengthCm: product.length_cm ? formatMoney(product.length_cm) : null,
      widthCm: product.width_cm ? formatMoney(product.width_cm) : null,
      heightCm: product.height_cm ? formatMoney(product.height_cm) : null,
      howToUse: product.how_to_use,
      careInstructions: product.care_instructions,
      safetyInfo: product.safety_info,
      category: {
        id: product.category!.id,
        name: product.category!.name,
        slug: product.category!.slug,
        petType: product.category!.pet_type
      },
      primaryImage: primaryImg ?? null,
      averageRating: rating?.averageRating ?? 0,
      reviewCount: rating?.reviewCount ?? 0,
      variants,
      images,
      features,
      specifications,
      contentBlocks,
      productVideos,
      testimonialVideos,
      relatedProducts,
      faqs
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
        { model: ProductImage, as: "images", required: false },
        { model: ProductFeature, as: "features", required: false },
        { model: ProductSpecification, as: "specifications", required: false },
        {
          model: ProductContentBlock,
          as: "contentBlocks",
          required: false,
          include: [{ model: MediaAsset, as: "media" }]
        },
        {
          model: ProductMediaAssignment,
          as: "mediaAssignments",
          required: false,
          include: [{ model: MediaAsset, as: "mediaAsset" }]
        },
        {
          model: ProductFaq,
          as: "faqs",
          required: false
        }
      ],
      order: [
        [{ model: ProductVariant, as: "variants" }, "display_order", "ASC"],
        [{ model: ProductImage, as: "images" }, "sort_order", "ASC"],
        [{ model: ProductFeature, as: "features" }, "display_order", "ASC"],
        [{ model: ProductFeature, as: "features" }, "id", "ASC"],
        [{ model: ProductSpecification, as: "specifications" }, "display_order", "ASC"],
        [{ model: ProductSpecification, as: "specifications" }, "id", "ASC"],
        [{ model: ProductContentBlock, as: "contentBlocks" }, "display_order", "ASC"],
        [{ model: ProductContentBlock, as: "contentBlocks" }, "id", "ASC"],
        [{ model: ProductMediaAssignment, as: "mediaAssignments" }, "display_order", "ASC"],
        [{ model: ProductMediaAssignment, as: "mediaAssignments" }, "id", "ASC"],
        [{ model: ProductFaq, as: "faqs" }, "display_order", "ASC"],
        [{ model: ProductFaq, as: "faqs" }, "id", "ASC"]
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
    const features = (product.features || []).map(formatFeatureDTO);
    const specifications = (product.specifications || []).map(formatAdminSpecificationDTO);
    const contentBlocks = (product.contentBlocks || []).map(formatAdminContentBlockDTO);
    const faqs = (product.faqs || []).map(formatAdminFaqDTO);
    const mediaAssignments = (product.mediaAssignments || []).map(formatMediaAssignmentDTO);
    const productVideos = mediaAssignments.filter((a) => a.mediaRole === "product_video");
    const testimonialVideos = mediaAssignments.filter((a) => a.mediaRole === "testimonial_video");
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
      howToUse: product.how_to_use,
      careInstructions: product.care_instructions,
      safetyInfo: product.safety_info,
      variantCount: variants.length,
      tags: normalizeProductTags(product.tags),
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
      features,
      specifications,
      contentBlocks,
      productVideos,
      testimonialVideos,
      faqs,
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
          height_cm: input.heightCm ? formatMoney(input.heightCm) : null,
          how_to_use: input.howToUse || null,
          care_instructions: input.careInstructions || null,
          safety_info: input.safetyInfo || null
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

      if (input.features && input.features.length > 0) {
        const featureCount = input.features.length;
        const featureIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productFeatures, featureCount, t);

        for (let i = 0; i < featureCount; i++) {
          const fInput = input.features[i]!;
          const fId = featureIds[i]!;

          await ProductFeature.create(
            {
              id: fId,
              product_id: productId,
              label: fInput.label,
              display_order: fInput.displayOrder ?? i
            },
            { transaction: t }
          );
        }
      }

      if (input.specifications && input.specifications.length > 0) {
        const specificationCount = input.specifications.length;
        const specificationIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productSpecifications, specificationCount, t);

        for (let i = 0; i < specificationCount; i++) {
          const sInput = input.specifications[i]!;
          const sId = specificationIds[i]!;

          // Reserved-label and intra-request duplicate label checks already ran
          // in createProductSchema; no existing rows can exist yet for a brand
          // new Product, so no additional duplicate lookup is needed here.
          await ProductSpecification.create(
            {
              id: sId,
              product_id: productId,
              label: sInput.label,
              value: sInput.value,
              display_order: sInput.displayOrder ?? i
            },
            { transaction: t }
          );
        }
      }

      if (input.contentBlocks && input.contentBlocks.length > 0) {
        const blockCount = input.contentBlocks.length;
        const blockIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productContentBlocks, blockCount, t);

        for (let i = 0; i < blockCount; i++) {
          const bInput = input.contentBlocks[i]!;
          const bId = blockIds[i]!;
          if (bInput.mediaAssetId != null) {
            const asset = await MediaAsset.findByPk(bInput.mediaAssetId, { transaction: t });
            if (!asset) {
              throw new MediaAssetNotFoundError(bInput.mediaAssetId);
            }
          }

          await ProductContentBlock.create(
            {
              id: bId,
              product_id: productId,
              media_asset_id: bInput.mediaAssetId ?? null,
              heading: bInput.heading || null,
              description: bInput.description || null,
              layout: bInput.layout ?? "media_left",
              display_order: bInput.displayOrder ?? i,
              active: bInput.active ?? true
            },
            { transaction: t }
          );
        }
      }

      if (input.mediaAssignments && input.mediaAssignments.length > 0) {
        const assignmentCount = input.mediaAssignments.length;
        const assignmentIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productMediaAssignments, assignmentCount, t);

        for (let i = 0; i < assignmentCount; i++) {
          const mInput = input.mediaAssignments[i]!;
          const mId = assignmentIds[i]!;
          await assertVideoMediaAsset(mInput.mediaAssetId, t);

          await ProductMediaAssignment.create(
            {
              id: mId,
              product_id: productId,
              media_asset_id: mInput.mediaAssetId,
              media_role: mInput.mediaRole,
              title: mInput.title ?? null,
              caption: mInput.caption ?? null,
              display_order: mInput.displayOrder ?? i,
              active: mInput.active ?? true
            },
            { transaction: t }
          );
        }
      }

      if (input.faqs && input.faqs.length > 0) {
        const faqCount = input.faqs.length;
        const faqIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productFaqs, faqCount, t);

        for (let i = 0; i < faqCount; i++) {
          const fInput = input.faqs[i]!;
          const fId = faqIds[i]!;

          await ProductFaq.create(
            {
              id: fId,
              product_id: productId,
              question: fInput.question,
              answer: fInput.answer,
              display_order: fInput.displayOrder ?? i
            },
            { transaction: t }
          );
        }
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
      if (input.howToUse !== undefined) updates.how_to_use = input.howToUse || null;
      if (input.careInstructions !== undefined) updates.care_instructions = input.careInstructions || null;
      if (input.safetyInfo !== undefined) updates.safety_info = input.safetyInfo || null;

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
      include: [
        { model: ProductVariant, as: "variants" },
        { model: ProductFeature, as: "features" },
        { model: ProductSpecification, as: "specifications" },
        { model: ProductContentBlock, as: "contentBlocks" },
        { model: ProductMediaAssignment, as: "mediaAssignments" },
        { model: ProductFaq, as: "faqs" }
      ]
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
          height_cm: source.height_cm,
          how_to_use: source.how_to_use,
          care_instructions: source.care_instructions,
          safety_info: source.safety_info
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

      if (source.features && source.features.length > 0) {
        const featureCount = source.features.length;
        const featureIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productFeatures, featureCount, t);

        for (let i = 0; i < featureCount; i++) {
          const f = source.features[i]!;
          const newFeatureId = featureIds[i]!;

          await ProductFeature.create(
            {
              id: newFeatureId,
              product_id: newProductId,
              label: f.label,
              display_order: f.display_order
            },
            { transaction: t }
          );
        }
      }

      if (source.specifications && source.specifications.length > 0) {
        const specificationCount = source.specifications.length;
        const specificationIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productSpecifications, specificationCount, t);

        for (let i = 0; i < specificationCount; i++) {
          const s = source.specifications[i]!;
          const newSpecificationId = specificationIds[i]!;

          await ProductSpecification.create(
            {
              id: newSpecificationId,
              product_id: newProductId,
              label: s.label,
              value: s.value,
              display_order: s.display_order
            },
            { transaction: t }
          );
        }
      }

      if (source.contentBlocks && source.contentBlocks.length > 0) {
        const blockCount = source.contentBlocks.length;
        const blockIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productContentBlocks, blockCount, t);

        for (let i = 0; i < blockCount; i++) {
          const b = source.contentBlocks[i]!;
          const newBlockId = blockIds[i]!;

          // Reuses the same media_asset_id — never duplicates the R2 object
          // (see CLAUDE.md Enhanced Product Content §20).
          await ProductContentBlock.create(
            {
              id: newBlockId,
              product_id: newProductId,
              media_asset_id: b.media_asset_id,
              heading: b.heading,
              description: b.description,
              layout: b.layout,
              display_order: b.display_order,
              active: b.active
            },
            { transaction: t }
          );
        }
      }

      if (source.mediaAssignments && source.mediaAssignments.length > 0) {
        const assignmentCount = source.mediaAssignments.length;
        const assignmentIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productMediaAssignments, assignmentCount, t);

        for (let i = 0; i < assignmentCount; i++) {
          const a = source.mediaAssignments[i]!;
          const newAssignmentId = assignmentIds[i]!;

          await ProductMediaAssignment.create(
            {
              id: newAssignmentId,
              product_id: newProductId,
              media_asset_id: a.media_asset_id,
              media_role: a.media_role,
              title: a.title,
              caption: a.caption,
              display_order: a.display_order,
              active: a.active
            },
            { transaction: t }
          );
        }
      }

      if (source.faqs && source.faqs.length > 0) {
        const faqCount = source.faqs.length;
        const faqIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.productFaqs, faqCount, t);

        for (let i = 0; i < faqCount; i++) {
          const f = source.faqs[i]!;
          const newFaqId = faqIds[i]!;

          await ProductFaq.create(
            {
              id: newFaqId,
              product_id: newProductId,
              question: f.question,
              answer: f.answer,
              display_order: f.display_order
            },
            { transaction: t }
          );
        }
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
