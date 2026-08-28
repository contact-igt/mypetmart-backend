import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { parseProductId } from "../ProductModels/product.validation.js";
import { StorefrontTestimonialService } from "./storefront-testimonial.service.js";

export async function handleListStorefrontTestimonials(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    sendSuccess(res, 200, await StorefrontTestimonialService.list());
  } catch (error) {
    next(error);
  }
}

export async function handleListProductTestimonials(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    sendSuccess(res, 200, await StorefrontTestimonialService.list({ productId }));
  } catch (error) {
    next(error);
  }
}
