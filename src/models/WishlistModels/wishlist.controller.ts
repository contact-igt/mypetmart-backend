import type { NextFunction, Request, Response } from "express";

import { SessionInvalidError } from "../AuthModels/auth.errors.js";
import { sendSuccess } from "../../utils/api-response.js";
import { WishlistService } from "./wishlist.service.js";
import { addWishlistItemSchema, parseWishlistProductId } from "./wishlist.validation.js";

function requireCustomerId(req: Request): number {
  // Guaranteed by authenticate("customer") running ahead of every route in this module.
  if (!req.user) {
    throw new SessionInvalidError();
  }
  return req.user.id;
}

export async function handleGetWishlist(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const wishlist = await WishlistService.getWishlist(requireCustomerId(req));
    sendSuccess(res, 200, wishlist);
  } catch (error) {
    next(error);
  }
}

export async function handleAddWishlistItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = addWishlistItemSchema.parse(req.body);
    const { wishlist, created } = await WishlistService.addItem(requireCustomerId(req), input.productId);
    sendSuccess(res, created ? 201 : 200, wishlist);
  } catch (error) {
    next(error);
  }
}

export async function handleRemoveWishlistItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseWishlistProductId(req.params.productId);
    const wishlist = await WishlistService.removeItem(requireCustomerId(req), productId);
    sendSuccess(res, 200, wishlist);
  } catch (error) {
    next(error);
  }
}
