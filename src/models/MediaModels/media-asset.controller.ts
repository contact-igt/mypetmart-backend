import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { MediaAssetService } from "./media-asset.service.js";
import {
  completeMediaAssetUploadSchema,
  mediaAssetListQuerySchema,
  parseMediaAssetId,
  presignMediaAssetUploadSchema,
  updateMediaAssetSchema
} from "./media-asset.validation.js";
import type { CompleteMediaAssetUploadInput, MediaAssetListQuery, UpdateMediaAssetInput } from "./media-asset.types.js";

function requireAdmin(req: Request): { id: number } {
  // Guaranteed by authenticate("admin") running ahead of every route in
  // admin-media.routes.ts — same defensive-check style as
  // admin-return.controller.ts's requireAdmin.
  if (!req.user) {
    throw new Error("Admin identity was not resolved before reaching the controller.");
  }
  return { id: req.user.id };
}

export async function handleAdminListMediaAssets(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = mediaAssetListQuerySchema.parse(req.query) as MediaAssetListQuery;
    const result = await MediaAssetService.listAdminMediaAssets(query);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminGetMediaAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseMediaAssetId(req.params.mediaAssetId);
    const asset = await MediaAssetService.getAdminMediaAssetById(id);
    sendSuccess(res, 200, asset);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminPresignMediaAssetUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = presignMediaAssetUploadSchema.parse(req.body);
    const authorization = await MediaAssetService.authorizeUpload(validated);
    sendSuccess(res, 200, authorization);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminCompleteMediaAssetUpload(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const admin = requireAdmin(req);
    const validated = completeMediaAssetUploadSchema.parse(req.body) as CompleteMediaAssetUploadInput;
    const asset = await MediaAssetService.completeUpload(validated, admin.id);
    sendSuccess(res, 201, asset);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateMediaAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseMediaAssetId(req.params.mediaAssetId);
    const validated = updateMediaAssetSchema.parse(req.body) as UpdateMediaAssetInput;
    const asset = await MediaAssetService.updateMediaAsset(id, validated);
    sendSuccess(res, 200, asset);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteMediaAsset(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseMediaAssetId(req.params.mediaAssetId);
    await MediaAssetService.deleteMediaAsset(id);
    sendSuccess(res, 200, { deleted: true, id });
  } catch (error) {
    next(error);
  }
}
