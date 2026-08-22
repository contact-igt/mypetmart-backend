import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ProductMediaAssignmentService } from "./product-media-assignment.service.js";
import type { CreateMediaAssignmentInput, UpdateMediaAssignmentInput } from "./product.types.js";
import {
  createMediaAssignmentSchema,
  parseMediaAssignmentId,
  parseProductId,
  reorderMediaAssignmentsSchema,
  updateMediaAssignmentSchema
} from "./product.validation.js";

export async function handleAdminCreateMediaAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = createMediaAssignmentSchema.parse(req.body) as CreateMediaAssignmentInput;
    const assignment = await ProductMediaAssignmentService.createAssignment(productId, validated);
    sendSuccess(res, 201, assignment);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateMediaAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const assignmentId = parseMediaAssignmentId(req.params.assignmentId);
    const validated = updateMediaAssignmentSchema.parse(req.body) as UpdateMediaAssignmentInput;
    const assignment = await ProductMediaAssignmentService.updateAssignment(productId, assignmentId, validated);
    sendSuccess(res, 200, assignment);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminDeleteMediaAssignment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const assignmentId = parseMediaAssignmentId(req.params.assignmentId);
    await ProductMediaAssignmentService.deleteAssignment(productId, assignmentId);
    sendSuccess(res, 200, { message: "Media assignment deleted successfully" });
  } catch (error) {
    next(error);
  }
}

export async function handleAdminReorderMediaAssignments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const productId = parseProductId(req.params.productId);
    const validated = reorderMediaAssignmentsSchema.parse(req.body);
    const assignments = await ProductMediaAssignmentService.reorderAssignments(productId, validated.mediaRole, validated.orderedIds);
    sendSuccess(res, 200, assignments);
  } catch (error) {
    next(error);
  }
}
