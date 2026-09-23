import type { NextFunction, Request, Response } from "express";
import type { ZodError } from "zod";
import { ValidationError } from "../AuthModels/auth.errors.js";
import { sendSuccess } from "../../utils/api-response.js";
import { AnnouncementBarService } from "./announcement-bar.service.js";
import {
  AnnouncementBarReorderSchema,
  CreateAnnouncementBarItemSchema,
  UpdateAnnouncementBarItemSchema,
  parseAnnouncementBarItemId
} from "./announcement-bar.validation.js";

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

export class StorefrontAnnouncementBarController {
  public static async listItems(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await AnnouncementBarService.listStorefrontItems();
      sendSuccess(res, 200, items);
    } catch (error) {
      next(error);
    }
  }
}

export class AdminAnnouncementBarController {
  public static async listItems(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const items = await AnnouncementBarService.listAdminItems();
      sendSuccess(res, 200, items);
    } catch (error) {
      next(error);
    }
  }

  public static async getItemById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseAnnouncementBarItemId(req.params.itemId);
      const item = await AnnouncementBarService.getAdminItemById(id);
      sendSuccess(res, 200, item);
    } catch (error) {
      next(error);
    }
  }

  public static async createItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = CreateAnnouncementBarItemSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const item = await AnnouncementBarService.createItem(result.data);
      sendSuccess(res, 201, item);
    } catch (error) {
      next(error);
    }
  }

  public static async updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseAnnouncementBarItemId(req.params.itemId);
      const result = UpdateAnnouncementBarItemSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const item = await AnnouncementBarService.updateItem(id, result.data);
      sendSuccess(res, 200, item);
    } catch (error) {
      next(error);
    }
  }

  public static async deleteItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseAnnouncementBarItemId(req.params.itemId);
      await AnnouncementBarService.deleteItem(id);
      sendSuccess(res, 200, { deleted: true });
    } catch (error) {
      next(error);
    }
  }

  public static async reorderItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = AnnouncementBarReorderSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const items = await AnnouncementBarService.reorderItems({
        items: result.data.items.map((i) => ({ itemId: i.itemId, displayOrder: i.displayOrder }))
      });
      sendSuccess(res, 200, items);
    } catch (error) {
      next(error);
    }
  }
}
