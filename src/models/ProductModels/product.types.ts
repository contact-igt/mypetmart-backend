import type { MediaAssetType, PetType, ProductContentLayout, ProductMediaRole, ProductStatus } from "../../constants/database.constants.js";

export type StorefrontCategorySummaryJSON = {
  id: number;
  name: string;
  slug: string;
  petType: PetType;
};

export type ProductImageJSON = {
  id: number;
  r2Key?: string;
  mediaAssetId: number | null;
  url: string;
  alt: string;
  contentType: string;
  sizeBytes: number | null;
  width: number | null;
  height: number | null;
  sortOrder: number;
  isPrimary: boolean;
};

export type ProductVariantJSON = {
  id: number;
  productId: number;
  name: string;
  sku: string;
  price: string;
  compareAtPrice: string | null;
  stock: number;
  active: boolean;
  displayOrder: number;
  weightGrams: number | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductFeatureJSON = {
  id: number;
  productId: number;
  label: string;
  displayOrder: number;
  createdAt: string;
  updatedAt: string;
};

// Storefront shape omits `id` — the storefront has no need to reference a
// specification row individually (see AdminProductSpecificationJSON for the
// Admin shape, which does).
export type ProductSpecificationJSON = {
  label: string;
  value: string;
  displayOrder: number;
};

export type AdminProductSpecificationJSON = ProductSpecificationJSON & {
  id: number;
};

// Storefront shape omits `id` — same rationale as ProductSpecificationJSON
// above (see AdminProductFaqJSON for the Admin shape, which keeps it for CRUD).
export type ProductFaqJSON = {
  question: string;
  answer: string;
  displayOrder: number;
};

export type AdminProductFaqJSON = ProductFaqJSON & {
  id: number;
};

// Media summary shared by a content block's `media` field — a subset of
// MediaAssetJSON (never storageKey/internal storage metadata; see CLAUDE.md
// Enhanced Product Content §9).
export type ProductContentBlockMediaJSON = {
  id: number;
  publicUrl: string;
  mediaType: MediaAssetType;
  mimeType: string;
  title: string | null;
  originalName: string;
};

// Storefront shape omits `id`/`mediaAssetId`/`active` — the storefront has no
// need to reference a block individually and only ever receives active blocks
// (see AdminProductContentBlockJSON for the Admin shape, which keeps all four).
export type ProductContentBlockJSON = {
  heading: string | null;
  description: string | null;
  layout: ProductContentLayout;
  displayOrder: number;
  media: Omit<ProductContentBlockMediaJSON, "id" | "originalName"> | null;
};

export type AdminProductContentBlockJSON = {
  id: number;
  mediaAssetId: number | null;
  heading: string | null;
  description: string | null;
  layout: ProductContentLayout;
  displayOrder: number;
  active: boolean;
  media: ProductContentBlockMediaJSON | null;
};

export type ProductMediaAssignmentMediaJSON = {
  id: number;
  publicUrl: string;
  mimeType: string;
  mediaType: MediaAssetType;
  title: string | null;
  originalName: string;
};

export type ProductMediaAssignmentJSON = {
  id: number;
  mediaAssetId: number;
  mediaRole: ProductMediaRole;
  title: string | null;
  caption: string | null;
  displayOrder: number;
  active: boolean;
  media: ProductMediaAssignmentMediaJSON;
};

export type StorefrontProductListItemJSON = {
  id: number;
  name: string;
  slug: string;
  brand: string | null;
  description: string;
  petType: PetType;
  price: string;
  compareAtPrice: string | null;
  stock: number;
  hasVariants: boolean;
  featured: boolean;
  inStock: boolean;
  category: StorefrontCategorySummaryJSON;
  primaryImage: ProductImageJSON | null;
};

export type StorefrontProductDetailJSON = StorefrontProductListItemJSON & {
  sku: string;
  description: string;
  tags: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  weightGrams: number | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  howToUse: string | null;
  careInstructions: string | null;
  safetyInfo: string | null;
  variants: ProductVariantJSON[];
  images: ProductImageJSON[];
  features: ProductFeatureJSON[];
  specifications: ProductSpecificationJSON[];
  contentBlocks: ProductContentBlockJSON[];
  productVideos: ProductMediaAssignmentJSON[];
  testimonialVideos: ProductMediaAssignmentJSON[];
  relatedProducts: StorefrontProductListItemJSON[];
  faqs: ProductFaqJSON[];
};

export type AdminProductListItemJSON = {
  id: number;
  categoryId: number;
  name: string;
  slug: string;
  sku: string;
  petType: PetType;
  status: ProductStatus;
  price: string;
  compareAtPrice: string | null;
  stock: number;
  hasVariants: boolean;
  featured: boolean;
  weightGrams: number | null;
  lengthCm: string | null;
  widthCm: string | null;
  heightCm: string | null;
  variantCount: number;
  category: StorefrontCategorySummaryJSON;
  primaryImage: ProductImageJSON | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  restorable: boolean;
  restoreBlockedReason: string | null;
};

export type AdminProductDetailJSON = AdminProductListItemJSON & {
  brand: string | null;
  description: string;
  tags: string[];
  metaTitle: string | null;
  metaDescription: string | null;
  howToUse: string | null;
  careInstructions: string | null;
  safetyInfo: string | null;
  variants: ProductVariantJSON[];
  images: ProductImageJSON[];
  features: ProductFeatureJSON[];
  specifications: AdminProductSpecificationJSON[];
  contentBlocks: AdminProductContentBlockJSON[];
  productVideos: ProductMediaAssignmentJSON[];
  testimonialVideos: ProductMediaAssignmentJSON[];
  faqs: AdminProductFaqJSON[];
};

export type CreateFeatureInput = {
  label: string;
  displayOrder?: number;
};

export type UpdateFeatureInput = Partial<CreateFeatureInput>;

export type CreateSpecificationInput = {
  label: string;
  value: string;
  displayOrder?: number;
};

export type UpdateSpecificationInput = Partial<CreateSpecificationInput>;

export type CreateFaqInput = {
  question: string;
  answer: string;
  displayOrder?: number;
};

export type UpdateFaqInput = Partial<CreateFaqInput>;

export type CreateContentBlockInput = {
  mediaAssetId?: number | null;
  heading?: string | null;
  description?: string | null;
  layout?: ProductContentLayout;
  displayOrder?: number;
  active?: boolean;
};

export type UpdateContentBlockInput = Partial<CreateContentBlockInput>;

export type CreateMediaAssignmentInput = {
  mediaAssetId: number;
  mediaRole: ProductMediaRole;
  title?: string | null;
  caption?: string | null;
  displayOrder?: number;
  active?: boolean;
};

// mediaRole is intentionally immutable after creation — reassigning an existing
// assignment between product_video/testimonial_video would silently move it
// between two differently-ordered lists; delete and re-add instead.
export type UpdateMediaAssignmentInput = {
  title?: string | null;
  caption?: string | null;
  displayOrder?: number;
  active?: boolean;
};

export type CreateVariantInput = {
  name: string;
  sku: string;
  price: string;
  compareAtPrice?: string | null;
  stock?: number;
  active?: boolean;
  displayOrder?: number;
  weightGrams?: number | null;
  lengthCm?: string | number | null;
  widthCm?: string | number | null;
  heightCm?: string | number | null;
};

export type UpdateVariantInput = Partial<CreateVariantInput>;

export type CreateProductInput = {
  categoryId: number;
  name: string;
  sku: string;
  brand?: string | null;
  description: string;
  petType?: PetType;
  status?: ProductStatus;
  price?: string;
  compareAtPrice?: string | null;
  stock?: number;
  hasVariants?: boolean;
  featured?: boolean;
  tags?: string[];
  metaTitle?: string | null;
  metaDescription?: string | null;
  weightGrams?: number | null;
  lengthCm?: string | number | null;
  widthCm?: string | number | null;
  heightCm?: string | number | null;
  howToUse?: string | null;
  careInstructions?: string | null;
  safetyInfo?: string | null;
  variants?: CreateVariantInput[];
  features?: CreateFeatureInput[];
  specifications?: CreateSpecificationInput[];
  contentBlocks?: CreateContentBlockInput[];
  mediaAssignments?: CreateMediaAssignmentInput[];
  faqs?: CreateFaqInput[];
};

export type UpdateProductInput = {
  categoryId?: number;
  name?: string;
  sku?: string;
  brand?: string | null;
  description?: string;
  petType?: PetType;
  price?: string;
  compareAtPrice?: string | null;
  stock?: number;
  featured?: boolean;
  tags?: string[];
  metaTitle?: string | null;
  metaDescription?: string | null;
  weightGrams?: number | null;
  lengthCm?: string | number | null;
  widthCm?: string | number | null;
  heightCm?: string | number | null;
  howToUse?: string | null;
  careInstructions?: string | null;
  safetyInfo?: string | null;
};

export type AdminProductSummaryJSON = {
  total: number;
  active: number;
  draft: number;
  archived: number;
  outOfStock: number;
};

export type AttachImageInput = {
  r2Key: string;
  url: string;
  alt: string;
  contentType: string;
  sizeBytes?: number | null;
  width?: number | null;
  height?: number | null;
  sortOrder?: number;
  isPrimary?: boolean;
};

export type PresignProductImageInput = {
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
};

export type CompleteProductImageUploadInput = {
  uploadToken: string;
  alt: string;
  width?: number | null;
  height?: number | null;
  sortOrder?: number;
  isPrimary?: boolean;
};

export type UpdateImageInput = {
  alt?: string;
  sortOrder?: number;
  isPrimary?: boolean;
};

export type AttachImageFromMediaAssetInput = {
  mediaAssetId: number;
  alt?: string;
  sortOrder?: number;
  isPrimary?: boolean;
};

export type StorefrontProductListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  category?: string;
  petType?: PetType;
  sort?: "newest" | "price_asc" | "price_desc" | "name";
  featured?: boolean;
};

export type AdminProductListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  categoryId?: number;
  status?: ProductStatus | "deleted";
  petType?: PetType;
  stockLevel?: "in_stock" | "out_of_stock" | "low_stock";
  sort?: "created_at" | "price" | "name" | "stock";
  order?: "ASC" | "DESC";
};
