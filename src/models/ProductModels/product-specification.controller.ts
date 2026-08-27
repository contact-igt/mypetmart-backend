import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ProductSpecificationService } from "./product-specification.service.js";
import type { CreateSpecificationInput, UpdateSpecificationInput } from "./product.types.js";
import { createSpecificationSchema, parseProductId, parseSpecificationId, reorderSchema, updateSpecificationSchema } from "./product.validation.js";

export async function handleAdminCreateSpecification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = createSpecificationSchema.parse(req.body) as CreateSpecificationInput;
    const specification = await ProductSpecificationService.createSpecification(productId, validated);
    sendSuccess(res, 201, specification);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateSpecification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const specificationId = parseSpecificationId(req.params.specificationId);
    const validated = updateSpecificationSchema.parse(req.body) as UpdateSpecificationInput;
    const specification = await ProductSpecificationService.updateSpecification(productId, specificationId, validated);
    sendSuccess(res, 200, specification);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteSpecification(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const specificationId = parseSpecificationId(req.params.specificationId);
    await ProductSpecificationService.deleteSpecification(productId, specificationId);
    sendSuccess(res, 200, { message: "Specification deleted successfully" });
  } catch (error) {
    next(error);
  }
}

export async function handleAdminReorderSpecifications(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = reorderSchema.parse(req.body);
    const specifications = await ProductSpecificationService.reorderSpecifications(productId, validated.orderedIds);
    sendSuccess(res, 200, specifications);
  } catch (error) {
    next(error);
  }
}
