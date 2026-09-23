import type { NextFunction, Request, Response } from "express";
import type { ZodError } from "zod";
import { ValidationError } from "../AuthModels/auth.errors.js";
import { sendSuccess } from "../../utils/api-response.js";
import { WelcomePopupService } from "./welcome-popup.service.js";
import {
  CreateWelcomePopupSchema,
  ListAdminWelcomePopupsQuerySchema,
  UpdateWelcomePopupSchema,
  parseWelcomePopupId
} from "./welcome-popup.validation.js";

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

export class StorefrontWelcomePopupController {
  public static async getActivePopup(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const popup = await WelcomePopupService.getStorefrontActivePopup();
      sendSuccess(res, 200, popup);
    } catch (error) {
      next(error);
    }
  }
}

export class AdminWelcomePopupController {
  public static async listCouponOptions(_req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      sendSuccess(res, 200, await WelcomePopupService.listCouponOptions());
    } catch (error) {
      next(error);
    }
  }

  public static async listItems(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = ListAdminWelcomePopupsQuerySchema.safeParse(req.query);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const items = await WelcomePopupService.listAdminItems(result.data);
      sendSuccess(res, 200, items);
    } catch (error) {
      next(error);
    }
  }

  public static async getItemById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseWelcomePopupId(req.params.popupId);
      const item = await WelcomePopupService.getAdminItemById(id);
      sendSuccess(res, 200, item);
    } catch (error) {
      next(error);
    }
  }

  public static async createItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = CreateWelcomePopupSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const item = await WelcomePopupService.createItem(result.data);
      sendSuccess(res, 201, item);
    } catch (error) {
      next(error);
    }
  }

  public static async updateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseWelcomePopupId(req.params.popupId);
      const result = UpdateWelcomePopupSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const item = await WelcomePopupService.updateItem(id, result.data);
      sendSuccess(res, 200, item);
    } catch (error) {
      next(error);
    }
  }

  public static async publishItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseWelcomePopupId(req.params.popupId);
      const item = await WelcomePopupService.publishItem(id);
      sendSuccess(res, 200, item);
    } catch (error) {
      next(error);
    }
  }

  public static async activateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseWelcomePopupId(req.params.popupId);
      const item = await WelcomePopupService.activateItem(id);
      sendSuccess(res, 200, item);
    } catch (error) {
      next(error);
    }
  }

  public static async deactivateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseWelcomePopupId(req.params.popupId);
      const item = await WelcomePopupService.deactivateItem(id);
      sendSuccess(res, 200, item);
    } catch (error) {
      next(error);
    }
  }

  public static async archiveItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseWelcomePopupId(req.params.popupId);
      const item = await WelcomePopupService.archiveItem(id);
      sendSuccess(res, 200, item);
    } catch (error) {
      next(error);
    }
  }

  public static async duplicateItem(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseWelcomePopupId(req.params.popupId);
      const item = await WelcomePopupService.duplicateItem(id);
      sendSuccess(res, 201, item);
    } catch (error) {
      next(error);
    }
  }
}
