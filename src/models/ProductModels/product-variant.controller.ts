import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ProductVariantService } from "./product-variant.service.js";
import type { CreateVariantInput, UpdateVariantInput } from "./product.types.js";
import { createVariantSchema, parseProductId, parseVariantId, reorderSchema, updateVariantSchema } from "./product.validation.js";

export async function handleAdminCreateVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = createVariantSchema.parse(req.body) as CreateVariantInput;
    const variant = await ProductVariantService.createVariant(productId, validated);
    sendSuccess(res, 201, variant);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const variantId = parseVariantId(req.params.variantId);
    const validated = updateVariantSchema.parse(req.body) as UpdateVariantInput;
    const variant = await ProductVariantService.updateVariant(productId, variantId, validated);
    sendSuccess(res, 200, variant);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteVariant(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const variantId = parseVariantId(req.params.variantId);
    await ProductVariantService.deleteVariant(productId, variantId);
    sendSuccess(res, 200, { message: "Variant soft-deleted successfully" });
  } catch (error) {
    next(error);
  }
}

export async function handleAdminReorderVariants(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = reorderSchema.parse(req.body);
    const variants = await ProductVariantService.reorderVariants(productId, validated.orderedIds);
    sendSuccess(res, 200, variants);
  } catch (error) {
    next(error);
  }
}
