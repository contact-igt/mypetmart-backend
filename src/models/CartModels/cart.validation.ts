import { z } from "zod";

import { MAX_CART_ITEM_QUANTITY } from "./cart.constants.js";
import { InvalidCartItemIdError } from "./cart.errors.js";

export function parseCartItemId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidCartItemIdError();
}

const positiveIntegerId = z.number().int().positive();

const quantitySchema = z.number().int().min(1).max(MAX_CART_ITEM_QUANTITY);

export const addCartItemSchema = z.object({
  productId: positiveIntegerId,
  variantId: positiveIntegerId.optional(),
  quantity: quantitySchema
});

export const updateCartItemSchema = z.object({
  quantity: quantitySchema
});
