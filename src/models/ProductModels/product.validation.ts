import { z } from "zod";
import { PET_TYPE_VALUES, PRODUCT_CONTENT_LAYOUT_VALUES, PRODUCT_MEDIA_ROLE_VALUES, PRODUCT_STATUS_VALUES } from "../../constants/database.constants.js";
import { formatMoney, isCompareAtPriceValid } from "../../utils/product-money.js";
import { SKU_REGEX } from "./catalog-sku.service.js";
import {
  InvalidContentBlockIdError,
  InvalidFaqIdError,
  InvalidFeatureIdError,
  InvalidImageIdError,
  InvalidMediaAssignmentIdError,
  InvalidProductIdError,
  InvalidSpecificationIdError,
  InvalidVariantIdError
} from "./product.errors.js";

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

export function parseFeatureId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidFeatureIdError();
}

export function parseSpecificationId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidSpecificationIdError();
}

export function parseFaqId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidFaqIdError();
}

export function parseContentBlockId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidContentBlockIdError();
}

export function parseMediaAssignmentId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidMediaAssignmentIdError();
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
  .union([z.string().trim(), z.number()])
  .refine((value) => {
    if (typeof value === "number") {
      return Number.isFinite(value) && value >= 0 && value < 100_000_000 && Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
    }
    return /^\d{1,8}(?:\.\d{1,2})?$/.test(value);
  }, "Price must be non-negative, fit DECIMAL(10,2), and have at most 2 decimal places")
  .transform((value) => formatMoney(value));

const variantMoneySchema = moneySchema.refine((value) => Number(value) > 0, "Variant price must be positive");

const optionalMoneySchema = z
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
  .union([z.number(), z.string().trim(), z.null()])
  .refine((value) => {
    if (value === null || value === "") return true;
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 && value < 1_000_000 && Math.abs(value * 100 - Math.round(value * 100)) < Number.EPSILON * 100;
    }
    return /^\d{1,6}(?:\.\d{1,2})?$/.test(value) && Number(value) > 0;
  }, "Shipping measurement must be positive, fit DECIMAL(8,2), and have at most 2 decimal places")
  .transform((value) => (value === null || value === "" ? null : Number(value)))
  .optional();

export const createVariantSchema = z
  .object({
    name: z.string().trim().min(1, "Variant name is required").max(160, "Variant name max 160 characters"),
    sku: skuSchema,
    price: variantMoneySchema,
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
    price: variantMoneySchema.optional(),
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

export const createFeatureSchema = z.object({
  label: z.string().trim().min(1, "Feature label is required").max(120, "Feature label max 120 characters"),
  displayOrder: z.number().int().min(0).optional().default(0)
});

export const updateFeatureSchema = z.object({
  label: z.string().trim().min(1, "Feature label is required").max(120, "Feature label max 120 characters").optional(),
  displayOrder: z.number().int().min(0).optional()
});

// Labels already owned by the Product's own structured commerce fields (see
// CLAUDE.md Product Specifications §5/§6) — rejected as a custom specification
// label so Admins cannot accidentally duplicate SKU/Price/MRP/Stock as
// free-form text that could drift out of sync with the real field.
export const RESERVED_SPECIFICATION_LABELS = ["sku", "price", "mrp", "compare at price", "compare-at price", "stock"] as const;

export function normalizeSpecificationLabel(label: string): string {
  return label.trim().toLowerCase();
}

export const createSpecificationSchema = z
  .object({
    label: z.string().trim().min(1, "Specification label is required").max(80, "Specification label max 80 characters"),
    value: z.string().trim().min(1, "Specification value is required").max(200, "Specification value max 200 characters"),
    // Deliberately no `.default(0)` here (unlike createFeatureSchema): a
    // schema-level default would resolve before the create-Product loop's
    // `input.displayOrder ?? i` fallback ever sees `undefined`, silently
    // collapsing every inline specification's order to 0. Left genuinely
    // optional so that fallback assigns each row its array index.
    displayOrder: z.number().int().min(0).optional()
  })
  .refine((data) => !RESERVED_SPECIFICATION_LABELS.includes(normalizeSpecificationLabel(data.label) as (typeof RESERVED_SPECIFICATION_LABELS)[number]), {
    message: "This label is already managed by the Product's own SKU, price, MRP, or stock fields.",
    path: ["label"]
  });

export const updateSpecificationSchema = z
  .object({
    label: z.string().trim().min(1, "Specification label is required").max(80, "Specification label max 80 characters").optional(),
    value: z.string().trim().min(1, "Specification value is required").max(200, "Specification value max 200 characters").optional(),
    displayOrder: z.number().int().min(0).optional()
  })
  .refine(
    (data) => data.label === undefined || !RESERVED_SPECIFICATION_LABELS.includes(normalizeSpecificationLabel(data.label) as (typeof RESERVED_SPECIFICATION_LABELS)[number]),
    {
      message: "This label is already managed by the Product's own SKU, price, MRP, or stock fields.",
      path: ["label"]
    }
  );

export const createFaqSchema = z.object({
  question: z.string().trim().min(1, "FAQ question is required").max(200, "FAQ question max 200 characters"),
  answer: z.string().trim().min(1, "FAQ answer is required").max(2000, "FAQ answer max 2000 characters"),
  // Deliberately no `.default(0)` here — same reasoning as createSpecificationSchema.displayOrder:
  // a schema-level default would collapse every inline FAQ's order to 0 before the
  // create-Product loop's `input.displayOrder ?? i` fallback ever sees `undefined`.
  displayOrder: z.number().int().min(0).optional()
});

export const updateFaqSchema = z.object({
  question: z.string().trim().min(1, "FAQ question is required").max(200, "FAQ question max 200 characters").optional(),
  answer: z.string().trim().min(1, "FAQ answer is required").max(2000, "FAQ answer max 2000 characters").optional(),
  displayOrder: z.number().int().min(0).optional()
});

export const createMediaAssignmentSchema = z.object({
  mediaAssetId: z.number().int().positive("Media asset ID must be positive"),
  mediaRole: z.enum(PRODUCT_MEDIA_ROLE_VALUES),
  title: z.string().trim().max(190, "Title max 190 characters").nullable().optional(),
  caption: z.string().trim().max(500, "Caption max 500 characters").nullable().optional(),
  displayOrder: z.number().int().min(0).optional().default(0),
  active: z.boolean().optional().default(true)
});

export const updateMediaAssignmentSchema = z.object({
  title: z.string().trim().max(190, "Title max 190 characters").nullable().optional(),
  caption: z.string().trim().max(500, "Caption max 500 characters").nullable().optional(),
  displayOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional()
});

// Shared by howToUse/careInstructions/safetyInfo — plain text, optional,
// generous length cap. Trim only; empty/whitespace-only -> null normalization
// happens in product.service.ts (`value || null`, mirroring the existing
// brand convention) so intentional internal line breaks survive untouched.
const optionalLongTextSchema = z.string().trim().max(5000, "Must be 5000 characters or fewer").nullable().optional();

// A block needs at least one of media/heading/description — a completely
// empty block is meaningless and rejected (see CLAUDE.md Enhanced Product
// Content §4). Checked against the already-trimmed/normalized values so a
// whitespace-only heading/description does not count as "present".
function hasContentBlockContent(data: { mediaAssetId?: number | null | undefined; heading?: string | null | undefined; description?: string | null | undefined }): boolean {
  return data.mediaAssetId != null || Boolean(data.heading?.trim()) || Boolean(data.description?.trim());
}

export const createContentBlockSchema = z
  .object({
    mediaAssetId: z.number().int().positive("Media asset ID must be positive").nullable().optional(),
    heading: z.string().trim().max(160, "Heading max 160 characters").nullable().optional(),
    description: optionalLongTextSchema,
    layout: z.enum(PRODUCT_CONTENT_LAYOUT_VALUES).optional().default("media_left"),
    // Deliberately no `.default(0)` here — see the identical reasoning on
    // createSpecificationSchema.displayOrder: a schema-level default would
    // resolve before the create-Product loop's `input.displayOrder ?? i`
    // fallback ever sees `undefined`, collapsing every inline block's order to 0.
    displayOrder: z.number().int().min(0).optional(),
    active: z.boolean().optional().default(true)
  })
  .refine(hasContentBlockContent, { message: "A content block needs at least one of: media, heading, or description.", path: ["heading"] });

export const updateContentBlockSchema = z.object({
  mediaAssetId: z.number().int().positive("Media asset ID must be positive").nullable().optional(),
  heading: z.string().trim().max(160, "Heading max 160 characters").nullable().optional(),
  description: optionalLongTextSchema,
  layout: z.enum(PRODUCT_CONTENT_LAYOUT_VALUES).optional(),
  displayOrder: z.number().int().min(0).optional(),
  active: z.boolean().optional()
});

export const reorderMediaAssignmentsSchema = z.object({
  mediaRole: z.enum(PRODUCT_MEDIA_ROLE_VALUES),
  orderedIds: z.array(z.number().int().positive()).min(1).refine((ids) => new Set(ids).size === ids.length, "orderedIds must not contain duplicates")
});

export const createProductSchema = z
  .object({
    categoryId: z.number().int().positive("Category ID must be positive"),
    name: z.string().trim().min(1, "Product name is required").max(190, "Product name max 190 characters"),
    slug: z.never({ message: "Product slug is system-controlled and generated from the Product name" }).optional(),
    sku: skuSchema,
    brand: z.string().trim().max(120, "Brand max 120 characters").nullable().optional(),
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
    howToUse: optionalLongTextSchema,
    careInstructions: optionalLongTextSchema,
    safetyInfo: optionalLongTextSchema,
    variants: z.array(createVariantSchema).optional(),
    features: z.array(createFeatureSchema).optional(),
    specifications: z
      .array(createSpecificationSchema)
      .optional()
      .refine(
        (specs) => !specs || new Set(specs.map((s) => normalizeSpecificationLabel(s.label))).size === specs.length,
        "Specification labels must be unique on a Product (case/whitespace-insensitive)"
      ),
    contentBlocks: z.array(createContentBlockSchema).optional(),
    mediaAssignments: z.array(createMediaAssignmentSchema).optional(),
    faqs: z.array(createFaqSchema).optional()
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
  slug: z.never({ message: "Product slug is system-controlled and cannot be changed" }).optional(),
  sku: skuSchema.optional(),
  brand: z.string().trim().max(120, "Brand max 120 characters").nullable().optional(),
  description: z.string().trim().min(1).optional(),
  petType: z.enum(PET_TYPE_VALUES).optional(),
  price: moneySchema.optional(),
  compareAtPrice: optionalMoneySchema,
  stock: z.number().int().min(0, "Stock cannot be negative").optional(),
  hasVariants: z.never({ message: "hasVariants is immutable after product creation" }).optional(),
  featured: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(50)).max(20).optional(),
  metaTitle: z.string().trim().max(190).nullable().optional(),
  metaDescription: z.string().trim().max(255).nullable().optional(),
  weightGrams: z.number().int().min(1).nullable().optional(),
  lengthCm: shippingMeasurementSchema,
  widthCm: shippingMeasurementSchema,
  heightCm: shippingMeasurementSchema,
  howToUse: optionalLongTextSchema,
  careInstructions: optionalLongTextSchema,
  safetyInfo: optionalLongTextSchema
});

const positiveQueryInteger = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().positive()
);

const queryPageSize = z.preprocess(
  (value) => (typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value),
  z.number().int().min(1).max(100)
);

const queryBoolean = z.preprocess((value) => value === "true" || value === true, z.boolean());

export const storefrontProductListQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  search: z.string().trim().max(190).optional(),
  category: z.string().trim().min(1).max(190).optional(),
  petType: z.enum(PET_TYPE_VALUES).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc", "name"]).optional(),
  featured: queryBoolean.optional()
});

export const adminProductListQuerySchema = z.object({
  page: positiveQueryInteger.optional(),
  pageSize: queryPageSize.optional(),
  search: z.string().trim().max(190).optional(),
  categoryId: positiveQueryInteger.optional(),
  status: z.enum([...PRODUCT_STATUS_VALUES, "deleted"]).optional(),
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

export const presignProductImageSchema = z.object({
  originalFilename: z
    .string()
    .trim()
    .min(1, "Original filename is required")
    .max(255)
    .refine(
      (value) => !Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127),
      "Original filename contains invalid control characters"
    ),
  contentType: z.string().trim().toLowerCase().min(1).max(100),
  sizeBytes: z.number().int().positive()
});

export const completeProductImageUploadSchema = z.object({
  uploadToken: z.string().trim().min(32).max(4096),
  alt: z.string().trim().min(1, "Image alt text is required").max(255),
  width: z.number().int().min(1).max(20_000).nullable().optional(),
  height: z.number().int().min(1).max(20_000).nullable().optional(),
  sortOrder: z.number().int().min(0).optional(),
  isPrimary: z.boolean().optional()
});

export const updateImageSchema = z.object({
  alt: z.string().trim().min(1).max(255).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isPrimary: z.boolean().optional()
});

export const attachImageFromMediaAssetSchema = z.object({
  mediaAssetId: z.number().int().positive("Media asset ID must be positive"),
  alt: z.string().trim().min(1).max(255).optional(),
  sortOrder: z.number().int().min(0).optional(),
  isPrimary: z.boolean().optional().default(false)
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
