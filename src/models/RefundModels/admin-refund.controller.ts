import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { parseReturnId } from "../ReturnModels/return.validation.js";
import { RefundService } from "./refund.service.js";
import { RefundNotFoundError } from "./refund.errors.js";

function requireAdmin(req: Request): { id: number } {
  // Guaranteed by authenticate("admin") + authorize("super_admin") running
  // ahead of every route in admin-refund.routes.ts.
  if (!req.user) {
    throw new Error("Admin identity was not resolved before reaching the controller.");
  }
  return { id: req.user.id };
}

function parseRefundId(raw: unknown): number {
  // Same shape as parseReturnId — a refund id path param has the exact same
  // "positive safe integer" contract, just against a different resource.
  try {
    return parseReturnId(raw);
  } catch {
    throw new RefundNotFoundError(String(raw));
  }
}

export async function handleAdminInitiateRefund(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const result = await RefundService.initiateRefund(requireAdmin(req).id, returnId);
    sendSuccess(res, 201, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminRecheckRefund(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    requireAdmin(req);
    const refundId = parseRefundId(req.params.refundId);
    const result = await RefundService.recheckRefundStatus(refundId);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}
