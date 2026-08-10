import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ProductService } from "./product.service.js";
import {
  adminProductListQuerySchema,
  bulkDeleteSchema,
  bulkStatusSchema,
  createProductSchema,
  parseProductId,
  storefrontProductListQuerySchema,
  updateProductSchema,
  updateProductStatusSchema
} from "./product.validation.js";
import type { AdminProductListQuery, CreateProductInput, StorefrontProductListQuery, UpdateProductInput } from "./product.types.js";

export async function handleStorefrontListProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = storefrontProductListQuerySchema.parse(req.query) as StorefrontProductListQuery;
    const result = await ProductService.listStorefrontProducts(query);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleStorefrontGetProductBySlug(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const rawSlug = req.params.slug;
    const slug = Array.isArray(rawSlug) ? rawSlug[0] ?? "" : rawSlug ?? "";
    const product = await ProductService.getStorefrontProductBySlug(slug);
    sendSuccess(res, 200, product);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminListProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = adminProductListQuerySchema.parse(req.query) as AdminProductListQuery;
    const result = await ProductService.listAdminProducts(query);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminGetProductSummary(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const summary = await ProductService.getAdminProductSummary();
    sendSuccess(res, 200, summary);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminGetProductById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseProductId(req.params.productId);
    const product = await ProductService.getAdminProductById(id);
    sendSuccess(res, 200, product);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminCreateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = createProductSchema.parse(req.body) as CreateProductInput;
    const product = await ProductService.createProduct(validated);
    sendSuccess(res, 201, product);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseProductId(req.params.productId);
    const validated = updateProductSchema.parse(req.body) as UpdateProductInput;
    const product = await ProductService.updateProduct(id, validated);
    sendSuccess(res, 200, product);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateProductStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseProductId(req.params.productId);
    const validated = updateProductStatusSchema.parse(req.body);
    const product = await ProductService.updateProductStatus(id, validated.status);
    sendSuccess(res, 200, product);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseProductId(req.params.productId);
    await ProductService.deleteProduct(id);
    sendSuccess(res, 200, { message: "Product soft-deleted successfully" });
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDuplicateProduct(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const id = parseProductId(req.params.productId);
    const duplicated = await ProductService.duplicateProduct(id);
    sendSuccess(res, 201, duplicated);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminBulkUpdateStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = bulkStatusSchema.parse(req.body);
    const count = await ProductService.bulkUpdateStatus(validated.productIds, validated.status);
    sendSuccess(res, 200, { affected: count });
  } catch (error) {
    next(error);
  }
}

export async function handleAdminBulkDeleteProducts(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = bulkDeleteSchema.parse(req.body);
    const count = await ProductService.bulkDeleteProducts(validated.productIds);
    sendSuccess(res, 200, { affected: count });
  } catch (error) {
    next(error);
  }
}
