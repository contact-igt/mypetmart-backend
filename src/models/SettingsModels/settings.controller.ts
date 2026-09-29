import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { SettingsService } from "./settings.service.js";
import { payOnlineDiscountSchema, storeProfileSchema } from "./settings.validation.js";

export async function handleAdminGetPayOnlineDiscount(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, 200, await SettingsService.getPayOnlineDiscountSettings());
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdatePayOnlineDiscount(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = payOnlineDiscountSchema.parse(req.body);
    sendSuccess(res, 200, await SettingsService.updatePayOnlineDiscountSettings(validated));
  } catch (error) {
    next(error);
  }
}

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

// Public, unauthenticated read for the storefront Contact page. Explicitly
// re-picks the 4 fields rather than forwarding SettingsService's return
// value directly — StoreProfile only has these 4 fields today, but this
// keeps "what the public can see" a visible, deliberate list instead of an
// implicit assumption if the type ever grows an admin-only field later.
export async function handleStorefrontGetStoreProfile(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { storeName, supportEmail, supportPhone, address } = await SettingsService.getStoreProfile();
    sendSuccess(res, 200, { storeName, supportEmail, supportPhone, address });
  } catch (error) {
    next(error);
  }
}
