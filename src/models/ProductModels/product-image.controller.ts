import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ProductImageService } from "./product-image.service.js";
import type { AttachImageInput, UpdateImageInput } from "./product.types.js";
import { attachImageSchema, parseImageId, parseProductId, reorderSchema, updateImageSchema } from "./product.validation.js";

export async function handleAdminAttachImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = attachImageSchema.parse(req.body) as AttachImageInput;
    const image = await ProductImageService.attachImage(productId, validated);
    sendSuccess(res, 201, image);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const imageId = parseImageId(req.params.imageId);
    const validated = updateImageSchema.parse(req.body) as UpdateImageInput;
    const image = await ProductImageService.updateImage(productId, imageId, validated);
    sendSuccess(res, 200, image);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteImage(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const imageId = parseImageId(req.params.imageId);
    await ProductImageService.deleteImage(productId, imageId);
    sendSuccess(res, 200, { message: "Image metadata soft-deleted successfully" });
  } catch (error) {
    next(error);
  }
}

export async function handleAdminReorderImages(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = reorderSchema.parse(req.body);
    const images = await ProductImageService.reorderImages(productId, validated.orderedIds);
    sendSuccess(res, 200, images);
  } catch (error) {
    next(error);
  }
}
