import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ProductFeatureService } from "./product-feature.service.js";
import type { CreateFeatureInput, UpdateFeatureInput } from "./product.types.js";
import { createFeatureSchema, parseFeatureId, parseProductId, reorderSchema, updateFeatureSchema } from "./product.validation.js";

export async function handleAdminCreateFeature(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = createFeatureSchema.parse(req.body) as CreateFeatureInput;
    const feature = await ProductFeatureService.createFeature(productId, validated);
    sendSuccess(res, 201, feature);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateFeature(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const featureId = parseFeatureId(req.params.featureId);
    const validated = updateFeatureSchema.parse(req.body) as UpdateFeatureInput;
    const feature = await ProductFeatureService.updateFeature(productId, featureId, validated);
    sendSuccess(res, 200, feature);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteFeature(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const featureId = parseFeatureId(req.params.featureId);
    await ProductFeatureService.deleteFeature(productId, featureId);
    sendSuccess(res, 200, { message: "Feature deleted successfully" });
  } catch (error) {
    next(error);
  }
}

export async function handleAdminReorderFeatures(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = reorderSchema.parse(req.body);
    const features = await ProductFeatureService.reorderFeatures(productId, validated.orderedIds);
    sendSuccess(res, 200, features);
  } catch (error) {
    next(error);
  }
}
