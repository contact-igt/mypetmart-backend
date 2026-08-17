import { z } from "zod";

import { InvalidWishlistProductIdError } from "./wishlist.errors.js";

export function parseWishlistProductId(rawId: unknown): number {
  if (typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId > 0) {
    return rawId;
  }
  if (typeof rawId === "string" && /^\d+$/.test(rawId.trim())) {
    const parsed = Number(rawId.trim());
    if (Number.isSafeInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  throw new InvalidWishlistProductIdError();
}

const positiveIntegerId = z.number().int().positive();

export const addWishlistItemSchema = z.object({
  productId: positiveIntegerId
});
