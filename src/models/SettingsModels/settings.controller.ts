import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { SettingsService } from "./settings.service.js";
import { storeProfileSchema } from "./settings.validation.js";

export async function handleAdminGetStoreProfile(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const profile = await SettingsService.getStoreProfile();
    sendSuccess(res, 200, profile);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateStoreProfile(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = storeProfileSchema.parse(req.body);
    const profile = await SettingsService.updateStoreProfile(validated);
    sendSuccess(res, 200, profile);
  } catch (error) {
    next(error);
  }
}

export function handleAdminGetIntegrationsStatus(_req: Request, res: Response, next: NextFunction): void {
  try {
    const status = SettingsService.getIntegrationsStatus();
    sendSuccess(res, 200, status);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminListAdminUsers(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const admins = await SettingsService.listAdminUsers();
    sendSuccess(res, 200, admins);
  } catch (error) {
    next(error);
  }
}
