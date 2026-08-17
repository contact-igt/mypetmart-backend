import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { CheckoutService } from "./checkout.service.js";
import { checkoutPreviewSchema } from "./checkout.validation.js";
import type { CheckoutPreviewInput } from "./checkout.types.js";

function requireCartIdentity(req: Request) {
  // Guaranteed by resolveCartIdentity() running ahead of this route.
  if (!req.cartIdentity) {
    throw new Error("Cart identity was not resolved before reaching the controller.");
  }
  return req.cartIdentity;
}

export async function handleCheckoutPreview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = checkoutPreviewSchema.parse(req.body) as CheckoutPreviewInput;
    const preview = await CheckoutService.preview(requireCartIdentity(req), input);
    sendSuccess(res, 200, preview);
  } catch (error) {
    next(error);
  }
}
