import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ProductFaqService } from "./product-faq.service.js";
import type { CreateFaqInput, UpdateFaqInput } from "./product.types.js";
import { createFaqSchema, parseFaqId, parseProductId, reorderSchema, updateFaqSchema } from "./product.validation.js";

export async function handleAdminCreateFaq(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = createFaqSchema.parse(req.body) as CreateFaqInput;
    const faq = await ProductFaqService.createFaq(productId, validated);
    sendSuccess(res, 201, faq);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateFaq(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const faqId = parseFaqId(req.params.faqId);
    const validated = updateFaqSchema.parse(req.body) as UpdateFaqInput;
    const faq = await ProductFaqService.updateFaq(productId, faqId, validated);
    sendSuccess(res, 200, faq);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteFaq(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const faqId = parseFaqId(req.params.faqId);
    await ProductFaqService.deleteFaq(productId, faqId);
    sendSuccess(res, 200, { message: "FAQ deleted successfully" });
  } catch (error) {
    next(error);
  }
}

export async function handleAdminReorderFaqs(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = reorderSchema.parse(req.body);
    const faqs = await ProductFaqService.reorderFaqs(productId, validated.orderedIds);
    sendSuccess(res, 200, faqs);
  } catch (error) {
    next(error);
  }
}
