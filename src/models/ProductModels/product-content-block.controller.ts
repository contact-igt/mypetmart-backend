import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ProductContentBlockService } from "./product-content-block.service.js";
import type { CreateContentBlockInput, UpdateContentBlockInput } from "./product.types.js";
import { createContentBlockSchema, parseContentBlockId, parseProductId, reorderSchema, updateContentBlockSchema } from "./product.validation.js";

export async function handleAdminCreateContentBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = createContentBlockSchema.parse(req.body) as CreateContentBlockInput;
    const block = await ProductContentBlockService.createContentBlock(productId, validated);
    sendSuccess(res, 201, block);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateContentBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const blockId = parseContentBlockId(req.params.blockId);
    const validated = updateContentBlockSchema.parse(req.body) as UpdateContentBlockInput;
    const block = await ProductContentBlockService.updateContentBlock(productId, blockId, validated);
    sendSuccess(res, 200, block);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteContentBlock(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const blockId = parseContentBlockId(req.params.blockId);
    await ProductContentBlockService.deleteContentBlock(productId, blockId);
    sendSuccess(res, 200, { message: "Content block deleted successfully" });
  } catch (error) {
    next(error);
  }
}

export async function handleAdminReorderContentBlocks(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = reorderSchema.parse(req.body);
    const blocks = await ProductContentBlockService.reorderContentBlocks(productId, validated.orderedIds);
    sendSuccess(res, 200, blocks);
  } catch (error) {
    next(error);
  }
}
