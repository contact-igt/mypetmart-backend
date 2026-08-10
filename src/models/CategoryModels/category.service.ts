import { Op, type Transaction } from "sequelize";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Category, Product } from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import {
  CategoryDeleteBlockedError,
  CategoryNotFoundError,
  CategorySlugConflictError,
  InvalidCategoryDataError
} from "./category.errors.js";
import type {
  AdminCategoryItem,
  CategoryReorderInput,
  CreateCategoryInput,
  ListAdminCategoriesQuery,
  ListStorefrontCategoriesQuery,
  StorefrontCategorySummary,
  UpdateCategoryInput
} from "./category.types.js";
import { slugify } from "./category.validation.js";

export class CategoryService {
  public static toStorefrontSummary(category: Category): StorefrontCategorySummary {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      petType: category.pet_type,
      displayOrder: category.display_order,
      imageKey: category.image_key,
      imageUrl: category.image_url,
      imageAlt: category.image_alt
    };
  }

  public static toAdminItem(category: Category, productCount: number = 0): AdminCategoryItem {
    return {
      id: category.id,
      name: category.name,
      slug: category.slug,
      description: category.description,
      petType: category.pet_type,
      active: category.active,
      displayOrder: category.display_order,
      imageKey: category.image_key,
      imageUrl: category.image_url,
      imageAlt: category.image_alt,
      productCount,
      createdAt: category.created_at ? category.created_at.toISOString() : new Date().toISOString(),
      updatedAt: category.updated_at ? category.updated_at.toISOString() : new Date().toISOString()
    };
  }

  public static async listStorefrontCategories(
    query: ListStorefrontCategoriesQuery
  ): Promise<StorefrontCategorySummary[]> {
    const where: Record<string, unknown> = {
      active: true
    };

    if (query.petType) {
      where.pet_type = query.petType;
    }

    const categories = await Category.findAll({
      where,
      order: [
        ["display_order", "ASC"],
        ["id", "ASC"]
      ]
    });

    return categories.map((cat) => this.toStorefrontSummary(cat));
  }

  public static async getStorefrontCategoryBySlug(slug: string): Promise<StorefrontCategorySummary> {
    const category = await Category.findOne({
      where: {
        slug,
        active: true
      }
    });

    if (!category) {
      throw new CategoryNotFoundError();
    }

    return this.toStorefrontSummary(category);
  }

  public static async listAdminCategories(query: ListAdminCategoriesQuery): Promise<AdminCategoryItem[]> {
    const where: Record<string, unknown> = {};

    if (query.status === "active") {
      where.active = true;
    } else if (query.status === "inactive") {
      where.active = false;
    }

    if (query.petType) {
      where.pet_type = query.petType;
    }

    if (query.search && query.search.trim()) {
      const term = `%${query.search.trim()}%`;
      where[Op.or as unknown as string] = [
        { name: { [Op.like]: term } },
        { slug: { [Op.like]: term } }
      ];
    }

    const sortColumnMap: Record<string, string> = {
      displayOrder: "display_order",
      name: "name",
      createdAt: "created_at",
      id: "id"
    };

    const sortField = sortColumnMap[query.sort ?? "displayOrder"] ?? "display_order";
    const sortOrder = query.order === "DESC" ? "DESC" : "ASC";

    const categories = await Category.findAll({
      where,
      order: [
        [sortField, sortOrder],
        ["id", "ASC"]
      ]
    });

    if (categories.length === 0) {
      return [];
    }

    const categoryIds = categories.map((c) => c.id);

    const productCountsRaw = (await Product.findAll({
      attributes: ["category_id", [sequelize.fn("COUNT", sequelize.col("id")), "count"]],
      where: { category_id: categoryIds },
      group: ["category_id"],
      raw: true
    })) as unknown as Array<{ category_id: number; count: string | number }>;

    const countMap = new Map<number, number>();
    for (const row of productCountsRaw) {
      countMap.set(Number(row.category_id), Number(row.count ?? 0));
    }

    return categories.map((cat) => this.toAdminItem(cat, countMap.get(cat.id) ?? 0));
  }

  public static async getAdminCategoryById(id: number): Promise<AdminCategoryItem> {
    const category = await Category.findByPk(id);

    if (!category) {
      throw new CategoryNotFoundError();
    }

    const productCount = await Product.count({
      where: { category_id: id }
    });

    return this.toAdminItem(category, productCount);
  }

  public static async createCategory(input: CreateCategoryInput): Promise<AdminCategoryItem> {
    const rawSlug = input.slug && input.slug.trim() ? input.slug : input.name;
    const slug = slugify(rawSlug);

    if (!slug) {
      throw new InvalidCategoryDataError("Category slug cannot be empty.");
    }

    // Uniqueness check including soft-deleted rows
    const existing = await Category.findOne({
      where: { slug },
      paranoid: false
    });

    if (existing) {
      throw new CategorySlugConflictError(slug);
    }

    return await sequelize.transaction(async (t: Transaction) => {
      const allocatedId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.categories, t);
      const displayOrder = input.displayOrder ?? allocatedId;

      const category = await Category.create(
        {
          id: allocatedId,
          name: input.name,
          slug,
          description: input.description ?? null,
          pet_type: input.petType ?? "all",
          active: input.active ?? true,
          display_order: displayOrder,
          image_key: input.imageKey ?? null,
          image_url: input.imageUrl ?? null,
          image_alt: input.imageAlt ?? null
        },
        { transaction: t }
      );

      return this.toAdminItem(category, 0);
    });
  }

  public static async updateCategory(id: number, input: UpdateCategoryInput): Promise<AdminCategoryItem> {
    const category = await Category.findByPk(id);

    if (!category) {
      throw new CategoryNotFoundError();
    }

    let newSlug = category.slug;
    if (input.slug && input.slug.trim()) {
      newSlug = slugify(input.slug);
      if (newSlug !== category.slug) {
        const existing = await Category.findOne({
          where: { slug: newSlug },
          paranoid: false
        });
        if (existing) {
          throw new CategorySlugConflictError(newSlug);
        }
      }
    }

    if (input.name !== undefined) {
      category.name = input.name;
    }
    category.slug = newSlug;
    if (input.description !== undefined) {
      category.description = input.description;
    }
    if (input.petType !== undefined) {
      category.pet_type = input.petType;
    }
    if (input.imageKey !== undefined) {
      category.image_key = input.imageKey;
    }
    if (input.imageUrl !== undefined) {
      category.image_url = input.imageUrl;
    }
    if (input.imageAlt !== undefined) {
      category.image_alt = input.imageAlt;
    }

    await category.save();

    const productCount = await Product.count({
      where: { category_id: id }
    });

    return this.toAdminItem(category, productCount);
  }

  public static async updateCategoryStatus(id: number, active: boolean): Promise<AdminCategoryItem> {
    const category = await Category.findByPk(id);

    if (!category) {
      throw new CategoryNotFoundError();
    }

    category.active = active;
    await category.save();

    const productCount = await Product.count({
      where: { category_id: id }
    });

    return this.toAdminItem(category, productCount);
  }

  public static async reorderCategories(input: CategoryReorderInput): Promise<AdminCategoryItem[]> {
    return await sequelize.transaction(async (t: Transaction) => {
      const categoryIds = input.items.map((i) => i.categoryId);

      const categories = await Category.findAll({
        where: { id: categoryIds },
        transaction: t
      });

      if (categories.length !== categoryIds.length) {
        throw new InvalidCategoryDataError("One or more category IDs in reorder request do not exist.");
      }

      for (const item of input.items) {
        await Category.update(
          { display_order: item.displayOrder },
          { where: { id: item.categoryId }, transaction: t }
        );
      }

      const updatedCategories = await Category.findAll({
        where: { id: categoryIds },
        order: [
          ["display_order", "ASC"],
          ["id", "ASC"]
        ],
        transaction: t
      });

      return updatedCategories.map((cat) => this.toAdminItem(cat, 0));
    });
  }

  public static async deleteCategory(id: number): Promise<void> {
    const category = await Category.findByPk(id);

    if (!category) {
      throw new CategoryNotFoundError();
    }

    const productCount = await Product.count({
      where: { category_id: id }
    });

    if (productCount > 0) {
      throw new CategoryDeleteBlockedError("Cannot delete category with associated products.");
    }

    await category.destroy();
  }
}
