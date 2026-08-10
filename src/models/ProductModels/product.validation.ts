import { z } from "zod";
import { PET_TYPE_VALUES, PRODUCT_STATUS_VALUES } from "../../constants/database.constants.js";
import { formatMoney, isCompareAtPriceValid } from "../../utils/product-money.js";
import { SKU_REGEX } from "./catalog-sku.service.js";
import { InvalidImageIdError, InvalidProductIdError, InvalidVariantIdError } from "./product.errors.js";

export function slugify(text: string): string {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^\w-]+/g, "")
    .replace(/--+/g, "-")
    .replace(/^-+/, "")
    .replace(/-+$/, "");
}

export function parseProductId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidProductIdError();
}

export function parseVariantId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidVariantIdError();
}

export function parseImageId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidImageIdError();
}

const skuSchema = z.preprocess(
  (val) => (typeof val === "string" ? val.trim().toUpperCase() : val),
  z
    .string()
    .min(1, "SKU cannot be empty")
    .max(100, "SKU max length is 100")
    .regex(SKU_REGEX, "SKU contains invalid characters. Allowed: A-Z, 0-9, -, _, .")
);

const moneySchema = z
  .union([z.string(), z.number()])
  .transform((val) => formatMoney(val))
  .refine((val) => parseFloat(val) >= 0, "Price must be non-negative");

const optionalMoneySchema = z
  .union([z.string(), z.number(), z.null()])
  .transform((val) => (val === null || val === "" ? null : formatMoney(val)))
  .nullable()
  .optional();

const strictMoneyInputSchema = z
  .union([z.string().trim(), z.number()])
  .refine((value) => {
    if (typeof value === "number") {
      return Number.isFinite(value) && value >= 0 && Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
    }
    return /^\d{1,8}(?:\.\d{1,2})?$/.test(value);
  }, "Price must be non-negative, fit DECIMAL(10,2), and have at most 2 decimal places")
  .transform((value) => formatMoney(value));

const optionalStrictMoneyInputSchema = z
  .union([z.string().trim(), z.number(), z.null()])
  .refine((value) => {
    if (value === null || value === "") return true;
    if (typeof value === "number") {
      return Number.isFinite(value) && value >= 0 && value < 100_000_000 && Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
    }
    return /^\d{1,8}(?:\.\d{1,2})?$/.test(value);
  }, "compareAtPrice must be non-negative, fit DECIMAL(10,2), and have at most 2 decimal places")
  .transform((value) => (value === null || value === "" ? null : formatMoney(value)))
  .optional();

const shippingMeasurementSchema = z
  .union([z.number(), z.string(), z.null()])
  .transform((val) => {
    if (val === null || val === "") return null;
    const num = typeof val === "number" ? val : parseFloat(val);
    if (isNaN(num) || num <= 0) return null;
    return typeof val === "number" ? val : num;
  })
  .nullable()
  .optional();

export const createVariantSchema = z
  .object({
    name: z.string().trim().min(1, "Variant name is required").max(160, "Variant name max 160 characters"),
    sku: skuSchema,
    price: moneySchema,
    compareAtPrice: optionalMoneySchema,
    stock: z.number().int().min(0, "Stock cannot be negative").optional().default(0),
    active: z.boolean().optional().default(true),
    displayOrder: z.number().int().min(0).optional().default(0),
    weightGrams: z.number().int().min(1).nullable().optional(),
    lengthCm: shippingMeasurementSchema,
    widthCm: shippingMeasurementSchema,
    heightCm: shippingMeasurementSchema
  })
  .refine((data) => isCompareAtPriceValid(data.price, data.compareAtPrice), {
    message: "compareAtPrice must be greater than or equal to price",
    path: ["compareAtPrice"]
  });

export const updateVariantSchema = z
  .object({
    name: z.string().trim().min(1).max(160).optional(),
    sku: skuSchema.optional(),
    price: moneySchema.optional(),
    compareAtPrice: optionalMoneySchema,
    stock: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
    displayOrder: z.number().int().min(0).optional(),
    weightGrams: z.number().int().min(1).nullable().optional(),
    lengthCm: shippingMeasurementSchema,
    widthCm: shippingMeasurementSchema,
    heightCm: shippingMeasurementSchema
  })
  .refine(
    (data) => {
      if (data.price !== undefined && data.compareAtPrice !== undefined) {
        return isCompareAtPriceValid(data.price, data.compareAtPrice);
      }
      return true;
    },
    {
      message: "compareAtPrice must be greater than or equal to price",
      path: ["compareAtPrice"]
    }
  );

export const createProductSchema = z
  .object({
    categoryId: z.number().int().positive("Category ID must be positive"),
    name: z.string().trim().min(1, "Product name is required").max(190, "Product name max 190 characters"),
    slug: z.string().trim().min(1).max(190).optional(),
    sku: skuSchema,
    description: z.string().trim().min(1, "Product description is required"),
    petType: z.enum(PET_TYPE_VALUES).optional().default("all"),
    status: z.enum(PRODUCT_STATUS_VALUES).optional().default("draft"),
    price: optionalMoneySchema,
    compareAtPrice: optionalMoneySchema,
    stock: z.number().int().min(0, "Stock cannot be negative").optional().default(0),
    hasVariants: z.boolean().optional().default(false),
    featured: z.boolean().optional().default(false),
    tags: z.array(z.string().trim().min(1).max(50)).max(20).optional().default([]),
    metaTitle: z.string().trim().max(190).nullable().optional(),
    metaDescription: z.string().trim().max(255).nullable().optional(),
    weightGrams: z.number().int().min(1).nullable().optional(),
    lengthCm: shippingMeasurementSchema,
    widthCm: shippingMeasurementSchema,
    heightCm: shippingMeasurementSchema,
    variants: z.array(createVariantSchema).optional()
  })
  .refine(
    (data) => {
      if (!data.hasVariants && data.price) {
        return isCompareAtPriceValid(data.price, data.compareAtPrice);
      }
      return true;
    },
    {
      message: "compareAtPrice must be greater than or equal to price for simple product",
      path: ["compareAtPrice"]
    }
  );

export const updateProductSchema = z.object({
  categoryId: z.number().int().positive().optional(),
  name: z.string().trim().min(1).max(190).optional(),
  slug: z.string().trim().min(1).max(190).optional(),
  sku: skuSchema.optional(),
  description: z.string().trim().min(1).optional(),
  petType: z.enum(PET_TYPE_VALUES).optional(),
  price: strictMoneyInputSchema.optional(),
  compareAtPrice: optionalStrictMoneyInputSchema,
  stock: z.number().int().min(0, "Stock cannot be negative").optional(),
  hasVariants: z.never({ message: "hasVariants is immutable after product creation" }).optional(),
  featured: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  metaTitle: z.string().trim().max(190).nullable().optional(),
  metaDescription: z.string().trim().max(255).nullable().optional(),
  weightGrams: z.number().int().min(1).nullable().optional(),
  lengthCm: shippingMeasurementSchema,
  widthCm: shippingMeasurementSchema,
  heightCm: shippingMeasurementSchema
});

const positiveQueryInteger = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().positive()
);

const queryPageSize = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().min(1).max(100)
);

export const storefrontProductListQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  search: z.string().trim().max(190).optional(),
  category: z.string().trim().min(1).max(190).optional(),
  petType: z.enum(PET_TYPE_VALUES).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "name"]).optional()
});

export const adminProductListQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  search: z.string().trim().max(190).optional(),
  categoryId: positiveQueryInteger.optional(),
  status: z.enum(PRODUCT_STATUS_VALUES).optional(),
  petType: z.enum(PET_TYPE_VALUES).optional(),
  stockLevel: z.enum(["in_stock", "out_of_stock", "low_stock"]).optional(),
  sort: z.enum(["created_at", "price", "name", "stock"]).optional(),
  order: z.preprocess((value) => (typeof value === "string" ? value.toUpperCase() : value), z.enum(["ASC", "DESC"])).optional()
});

export const updateProductStatusSchema = z.object({
  status: z.enum(PRODUCT_STATUS_VALUES)
});

export const attachImageSchema = z.object({
  r2Key: z.string().trim().min(1, "R2 key is required").max(512).refine((val) => !val.includes("../"), "Invalid key: path traversal forbidden"),
  url: z.string().trim().url("Must be a valid HTTPS image URL").refine((val) => val.startsWith("https://"), "Image URL must use HTTPS"),
  alt: z.string().trim().min(1, "Image alt text is required").max(255),
  contentType: z.string().trim().min(1).max(100),
  sizeBytes: z.number().int().min(0).nullable().optional(),
  width: z.number().int().min(1).nullable().optional(),
  height: z.number().int().min(1).nullable().optional(),
  sortOrder: z.number().int().min(0).optional().default(0),
  isPrimary: z.boolean().optional().default(false)
});

export const updateImageSchema = z.object({
  alt: z.string().trim().min(1).max(255).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isPrimary: z.boolean().optional()
});

export const reorderSchema = z.object({
  orderedIds: z.array(z.number().int().positive()).min(1).refine((ids) => new Set(ids).size === ids.length, "orderedIds must not contain duplicates")
});

export const bulkStatusSchema = z.object({
  productIds: z.array(z.number().int().positive()).min(1).max(100),
  status: z.enum(PRODUCT_STATUS_VALUES)
});

export const bulkDeleteSchema = z.object({
  productIds: z.array(z.number().int().positive()).min(1).max(100)
});
