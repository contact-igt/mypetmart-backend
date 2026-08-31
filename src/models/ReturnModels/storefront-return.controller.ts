import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ReturnService } from "./return.service.js";
import { cancelReturnSchema, createReturnRequestSchema, listReturnsQuerySchema, parseReturnId } from "./return.validation.js";
import type { ReturnCaller } from "./return.types.js";

function resolveCaller(req: Request): ReturnCaller {
  // authenticate("customer") always runs ahead of every route in this
  // controller (see storefront-return.routes.ts) — req.user is guaranteed.
  if (!req.user) {
    throw new Error("Customer identity was not resolved before reaching the controller.");
  }
  return { userId: req.user.id };
}

export async function handleCreateReturnRequest(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = createReturnRequestSchema.parse(req.body);
    const result = await ReturnService.createReturnRequest(resolveCaller(req), input);
    sendSuccess(res, 201, result);
  } catch (error) {
    next(error);
  }
}

export async function handleListCustomerReturns(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = listReturnsQuerySchema.parse(req.query);
    const result = await ReturnService.listCustomerReturns(resolveCaller(req), query);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleGetCustomerReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const result = await ReturnService.getCustomerReturn(resolveCaller(req), returnId);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleCancelCustomerReturn(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const returnId = parseReturnId(req.params.returnId);
    const { reason } = cancelReturnSchema.parse(req.body);
    const result = await ReturnService.cancelCustomerReturn(resolveCaller(req), returnId, reason);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}
