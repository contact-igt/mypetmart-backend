import { z } from "zod";
import { PET_TYPE_VALUES } from "../../constants/database.constants.js";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { InvalidCategoryIdError, InvalidCategoryDataError } from "./category.errors.js";

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseCategoryId(param: unknown): number {
  if (typeof param !== "string") {
    throw new InvalidCategoryIdError();
  }
  try {
    return parseStrictIdClaim(param);
  } catch {
    throw new InvalidCategoryIdError();
  }
}

export function parseCategorySlug(param: unknown): string {
  if (typeof param !== "string" || !param.trim()) {
    throw new InvalidCategoryDataError("Category slug must be a non-empty string.");
  }
  return slugify(param);
}

const queryBoolean = z.preprocess((value) => value === "true" || value === true, z.boolean());

export const ListStorefrontCategoriesQuerySchema = z.object({
  petType: z.enum(PET_TYPE_VALUES).optional(),
  showOnHomepage: queryBoolean.optional().default(false)
});

export const ListAdminCategoriesQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  petType: z.enum(PET_TYPE_VALUES).optional(),
  status: z.enum(["active", "inactive", "deleted", "all"]).optional().default("all"),
  sort: z.enum(["displayOrder", "name", "createdAt", "id"]).optional().default("displayOrder"),
  order: z.enum(["ASC", "DESC"]).optional().default("ASC")
});

export const CreateCategorySchema = z.object({
  name: z.string().trim().min(1, "Category name is required.").max(160, "Category name cannot exceed 160 characters."),
  slug: z.string().trim().max(190, "Slug cannot exceed 190 characters.").optional(),
  description: z.string().trim().nullable().optional(),
  petType: z.enum(PET_TYPE_VALUES).optional().default("all"),
  active: z.boolean().optional().default(true),
  displayOrder: z.number().int().min(0, "Display order must be non-negative.").optional(),
  showOnHomepage: z.boolean().optional().default(false),
  imageKey: z.string().trim().max(512).nullable().optional(),
  imageUrl: z.string().trim().max(1000).nullable().optional(),
  imageAlt: z.string().trim().max(255).nullable().optional()
});

export const UpdateCategorySchema = z.object({
  name: z.string().trim().min(1).max(160).optional(),
  slug: z.string().trim().min(1).max(190).optional(),
  description: z.string().trim().nullable().optional(),
  petType: z.enum(PET_TYPE_VALUES).optional(),
  showOnHomepage: z.boolean().optional(),
  imageKey: z.string().trim().max(512).nullable().optional(),
  imageUrl: z.string().trim().max(1000).nullable().optional(),
  imageAlt: z.string().trim().max(255).nullable().optional()
});

export const UpdateCategoryStatusSchema = z.object({
  active: z.boolean({ message: "'active' boolean field is required." })
});

export const ReorderCategoryItemSchema = z.object({
  categoryId: z.number().int().positive("Category ID must be a positive integer."),
  displayOrder: z.number().int().min(0, "Display order must be a non-negative integer.")
});

export const CategoryReorderSchema = z.object({
  items: z
    .array(ReorderCategoryItemSchema)
    .min(1, "At least one item must be provided for reordering.")
    .refine((items) => {
      const categoryIds = new Set(items.map((i) => i.categoryId));
      return categoryIds.size === items.length;
    }, { message: "Duplicate category IDs are not allowed in reorder request." })
    .refine((items) => {
      const displayOrders = new Set(items.map((i) => i.displayOrder));
      return displayOrders.size === items.length;
    }, { message: "Duplicate display orders are not allowed in reorder request." })
});
