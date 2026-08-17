import type { NextFunction, Request, Response } from "express";

import { SessionInvalidError } from "../AuthModels/auth.errors.js";
import { clearGuestCartCookie, getGuestCartTokenHash } from "../../middlewares/cart/resolve-cart-identity.middleware.js";
import { sendSuccess } from "../../utils/api-response.js";
import { CartService } from "./cart.service.js";
import { addCartItemSchema, parseCartItemId, updateCartItemSchema } from "./cart.validation.js";
import type { AddCartItemInput } from "./cart.types.js";

function requireCartIdentity(req: Request) {
  // Guaranteed by resolveCartIdentity() running ahead of every route that uses this helper.
  if (!req.cartIdentity) {
    throw new Error("Cart identity was not resolved before reaching the controller.");
  }
  return req.cartIdentity;
}

export async function handleGetCart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cart = await CartService.getCart(requireCartIdentity(req));
    sendSuccess(res, 200, cart);
  } catch (error) {
    next(error);
  }
}

export async function handleAddCartItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = addCartItemSchema.parse(req.body) as AddCartItemInput;
    const cart = await CartService.addCartItem(requireCartIdentity(req), input);
    sendSuccess(res, 201, cart);
  } catch (error) {
    next(error);
  }
}

export async function handleUpdateCartItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cartItemId = parseCartItemId(req.params.cartItemId);
    const input = updateCartItemSchema.parse(req.body);
    const cart = await CartService.updateCartItemQuantity(requireCartIdentity(req), cartItemId, input.quantity);
    sendSuccess(res, 200, cart);
  } catch (error) {
    next(error);
  }
}

export async function handleRemoveCartItem(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cartItemId = parseCartItemId(req.params.cartItemId);
    const cart = await CartService.removeCartItem(requireCartIdentity(req), cartItemId);
    sendSuccess(res, 200, cart);
  } catch (error) {
    next(error);
  }
}

export async function handleClearCart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const cart = await CartService.clearCart(requireCartIdentity(req));
    sendSuccess(res, 200, cart);
  } catch (error) {
    next(error);
  }
}

export async function handleMergeCart(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.user) {
      throw new SessionInvalidError();
    }
    const guestTokenHash = getGuestCartTokenHash(req);
    const result = await CartService.mergeGuestCartIntoCustomerCart(req.user.id, guestTokenHash);
    clearGuestCartCookie(res);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}
