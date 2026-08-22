import type { PetType, ProductStatus } from "../../constants/database.constants.js";

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

export type StorefrontProductListItemJSON = {
  id: number;
  name: string;
  slug: string;
  brand: string | null;
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
  variants: ProductVariantJSON[];
  images: ProductImageJSON[];
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
  variants: ProductVariantJSON[];
  images: ProductImageJSON[];
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
  variants?: CreateVariantInput[];
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
