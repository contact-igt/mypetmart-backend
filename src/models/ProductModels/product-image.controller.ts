import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ProductImageService } from "./product-image.service.js";
import type { AttachImageFromMediaAssetInput, CompleteProductImageUploadInput, UpdateImageInput } from "./product.types.js";
import {
  attachImageFromMediaAssetSchema,
  completeProductImageUploadSchema,
  parseImageId,
  parseProductId,
  presignProductImageSchema,
  reorderSchema,
  updateImageSchema
} from "./product.validation.js";

export async function handleAdminPresignImageUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = presignProductImageSchema.parse(req.body);
    const authorization = await ProductImageService.authorizeUpload(productId, validated);
    sendSuccess(res, 200, authorization);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminCompleteImageUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = completeProductImageUploadSchema.parse(req.body) as CompleteProductImageUploadInput;
    const image = await ProductImageService.completeUpload(productId, validated);
    sendSuccess(res, 201, image);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminAttachImageFromGallery(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = attachImageFromMediaAssetSchema.parse(req.body) as AttachImageFromMediaAssetInput;
    const image = await ProductImageService.attachFromMediaAsset(productId, validated);
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
    sendSuccess(res, 200, { message: "Image metadata and its R2 object were deleted successfully" });
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
