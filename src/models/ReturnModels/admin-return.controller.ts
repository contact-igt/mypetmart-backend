import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ReplacementService } from "../ReplacementModels/replacement.service.js";
import { updateReplacementSchema } from "../ReplacementModels/replacement.validation.js";
import { ReturnShipmentService } from "../ReturnShipmentModels/return-shipment.service.js";
import { parseReturnShipmentId } from "../ReturnShipmentModels/return-shipment.validation.js";
import { ReturnService } from "./return.service.js";
import { addReturnNoteSchema, adminReviewReturnSchema, cancelReturnSchema, listReturnsQuerySchema, parseReturnId } from "./return.validation.js";

function requireAdmin(req: Request): { id: number } {
  // Guaranteed by authenticate("admin") running ahead of every route in
  // admin-return.routes.ts — same defensive-check style as
  // admin-order.controller.ts's requireAdmin.
  if (!req.user) {
    throw new Error("Admin identity was not resolved before reaching the controller.");
  }
  return { id: req.user.id };
}

export async function handleAdminListReturns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = listReturnsQuerySchema.parse(req.query);
    const result = await ReturnService.listAdminReturns(query);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminGetReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const result = await ReturnService.getAdminReturn(returnId);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminReviewReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const input = adminReviewReturnSchema.parse(req.body);
    const result = await ReturnService.adminReviewReturn(requireAdmin(req).id, returnId, input);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminMarkItemReceived(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const result = await ReturnService.markItemReceived(requireAdmin(req).id, returnId);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminAddReturnNote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const { message } = addReturnNoteSchema.parse(req.body);
    const result = await ReturnService.addAdminNote(requireAdmin(req).id, returnId, message);
    sendSuccess(res, 201, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateReplacement(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const input = updateReplacementSchema.parse(req.body);
    const result = await ReplacementService.updateStatus(requireAdmin(req).id, returnId, input);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

// Open to any admin (not super_admin-only) — booking a reverse pickup moves
// no money, same "operational fact" tier as markItemReceived above. Real
// gating is ReturnShipmentService.createForApprovedReturn's own eligibility
// check (return must already be "approved").
export async function handleAdminCreateReturnShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const result = await ReturnShipmentService.createForApprovedReturn(returnId);
    sendSuccess(res, 201, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminRefreshReturnShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const shipmentId = parseReturnShipmentId(req.params.shipmentId);
    const result = await ReturnShipmentService.refresh(shipmentId);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminCancelReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const { reason } = cancelReturnSchema.parse(req.body);
    const result = await ReturnService.cancelAdminReturn(requireAdmin(req).id, returnId, reason);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}
