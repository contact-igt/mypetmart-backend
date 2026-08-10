
import type { NextFunction, Request, Response } from "express";
import type { ZodError } from "zod";
import { ValidationError } from "../AuthModels/auth.errors.js";
import { sendSuccess } from "../../utils/api-response.js";
import { CategoryService } from "./category.service.js";
import {
  CategoryReorderSchema,
  CreateCategorySchema,
  ListAdminCategoriesQuerySchema,
  ListStorefrontCategoriesQuerySchema,
  UpdateCategorySchema,
  UpdateCategoryStatusSchema,
  parseCategoryId,
  parseCategorySlug
} from "./category.validation.js";

function parseZodErrors(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const pathKey = issue.path.join(".") || "body";
    if (!formatted[pathKey]) {
      formatted[pathKey] = [];
    }
    formatted[pathKey].push(issue.message);
  }
  return formatted;
}

export class StorefrontCategoryController {
  public static async listCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = ListStorefrontCategoriesQuerySchema.safeParse(req.query);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const categories = await CategoryService.listStorefrontCategories(result.data);
      sendSuccess(res, 200, categories);
    } catch (error) {
      next(error);
    }
  }

  public static async getCategoryBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const slug = parseCategorySlug(req.params.slug);
      const category = await CategoryService.getStorefrontCategoryBySlug(slug);
      sendSuccess(res, 200, category);
    } catch (error) {
      next(error);
    }
  }
}

export class AdminCategoryController {
  public static async listCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = ListAdminCategoriesQuerySchema.safeParse(req.query);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const categories = await CategoryService.listAdminCategories(result.data);
      sendSuccess(res, 200, categories);
    } catch (error) {
      next(error);
    }
  }

  public static async getCategoryById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseCategoryId(req.params.categoryId);
      const category = await CategoryService.getAdminCategoryById(id);
      sendSuccess(res, 200, category);
    } catch (error) {
      next(error);
    }
  }

  public static async createCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = CreateCategorySchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const category = await CategoryService.createCategory(result.data);
      sendSuccess(res, 201, category);
    } catch (error) {
      next(error);
    }
  }

  public static async updateCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseCategoryId(req.params.categoryId);
      const result = UpdateCategorySchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const category = await CategoryService.updateCategory(id, result.data);
      sendSuccess(res, 200, category);
    } catch (error) {
      next(error);
    }
  }

  public static async updateCategoryStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseCategoryId(req.params.categoryId);
      const result = UpdateCategoryStatusSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const category = await CategoryService.updateCategoryStatus(id, result.data.active);
      sendSuccess(res, 200, category);
    } catch (error) {
      next(error);
    }
  }

  public static async reorderCategories(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = CategoryReorderSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const categories = await CategoryService.reorderCategories(result.data);
      sendSuccess(res, 200, categories);
    } catch (error) {
      next(error);
    }
  }

  public static async deleteCategory(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseCategoryId(req.params.categoryId);
      await CategoryService.deleteCategory(id);
      sendSuccess(res, 200, { deleted: true, id });
    } catch (error) {
      next(error);
    }
  }
}
