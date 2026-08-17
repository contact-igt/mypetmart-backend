import type { PetType } from "../../constants/database.constants.js";

export type StorefrontCategorySummary = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  petType: PetType;
  displayOrder: number;
  imageKey: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
};

export type StorefrontCategoryDetail = StorefrontCategorySummary;

export type AdminCategoryItem = {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  petType: PetType;
  active: boolean;
  displayOrder: number;
  imageKey: string | null;
  imageUrl: string | null;
  imageAlt: string | null;
  productCount: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type AdminCategoryDetail = AdminCategoryItem;

export type CreateCategoryInput = {
  name: string;
  slug?: string | undefined;
  description?: string | null | undefined;
  petType?: PetType | undefined;
  active?: boolean | undefined;
  displayOrder?: number | undefined;
  imageKey?: string | null | undefined;
  imageUrl?: string | null | undefined;
  imageAlt?: string | null | undefined;
};

export type UpdateCategoryInput = {
  name?: string | undefined;
  slug?: string | undefined;
  description?: string | null | undefined;
  petType?: PetType | undefined;
  imageKey?: string | null | undefined;
  imageUrl?: string | null | undefined;
  imageAlt?: string | null | undefined;
};

export type UpdateCategoryStatusInput = {
  active: boolean;
};

export type ReorderCategoryItem = {
  categoryId: number;
  displayOrder: number;
};

export type CategoryReorderInput = {
  items: ReorderCategoryItem[];
};

export type ListStorefrontCategoriesQuery = {
  petType?: PetType | undefined;
};

export type ListAdminCategoriesQuery = {
  search?: string | undefined;
  petType?: PetType | undefined;
  status?: "active" | "inactive" | "deleted" | "all" | undefined;
  sort?: "displayOrder" | "name" | "createdAt" | "id" | undefined;
  order?: "ASC" | "DESC" | undefined;
};
