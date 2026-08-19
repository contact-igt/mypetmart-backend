import type { NextFunction, Request, Response } from "express";

import type { UserRole } from "../../constants/database.constants.js";
import { sendSuccess } from "../../utils/api-response.js";
import { AdminOrderService } from "./order.service.js";
import {
  addOrderNoteSchema,
  adminOrderListQuerySchema,
  bulkUpdateOrderStatusSchema,
  parseOrderId,
  updateOrderStatusSchema
} from "./order.validation.js";
import type { AdminOrderListQuery } from "./order.types.js";

function requireAdmin(req: Request): { id: number; name: string; role: UserRole } {
  // Guaranteed by authenticate("admin") running ahead of this route.
  if (!req.user) {
    throw new Error("Admin identity was not resolved before reaching the controller.");
  }
  return { id: req.user.id, name: req.user.name, role: req.user.role };
}

export async function handleAdminGetOrderSummary(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const summary = await AdminOrderService.getSummary();
    sendSuccess(res, 200, summary);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminListOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = adminOrderListQuerySchema.parse(req.query) as AdminOrderListQuery;
    const result = await AdminOrderService.listOrders(query);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminGetOrderById(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orderId = parseOrderId(req.params.orderId);
    const order = await AdminOrderService.getOrderDetail(orderId);
    sendSuccess(res, 200, order);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminUpdateOrderStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orderId = parseOrderId(req.params.orderId);
    const validated = updateOrderStatusSchema.parse(req.body);
    const order = await AdminOrderService.updateStatus(orderId, validated.status, requireAdmin(req));
    sendSuccess(res, 200, order);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminBulkUpdateOrderStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = bulkUpdateOrderStatusSchema.parse(req.body);
    const result = await AdminOrderService.bulkUpdateStatus(validated.ids, validated.status, requireAdmin(req));
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminAddOrderNote(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orderId = parseOrderId(req.params.orderId);
    const validated = addOrderNoteSchema.parse(req.body);
    const note = await AdminOrderService.addNote(orderId, requireAdmin(req), validated);
    sendSuccess(res, 201, note);
  } catch (error) {
    next(error);
  }
}
