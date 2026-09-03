import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import type { CartIdentity } from "../CartModels/cart.types.js";
import { ReceiptService } from "../DocumentModels/receipt.service.js";
import { OrderService } from "./order.service.js";
import { createOrderSchema, customerOrderListQuerySchema, parseGuestOrderToken, parseOrderId } from "./order.validation.js";
import type { CreateOrderInput, CustomerOrderListQuery } from "./order.types.js";

function requireCustomerId(req: Request): number {
  // Guaranteed by authenticate("customer") running ahead of this route.
  if (!req.user) {
    throw new Error("Customer identity was not resolved before reaching the controller.");
  }
  return req.user.id;
}

function requireCartIdentity(req: Request): CartIdentity {
  // Guaranteed by resolveCartIdentity() running ahead of this route — the
  // same guest/customer identity resolution Checkout Preview uses.
  if (!req.cartIdentity) {
    throw new Error("Cart identity was not resolved before reaching the controller.");
  }
  return req.cartIdentity;
}

export async function handleCreateOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = createOrderSchema.parse(req.body) as CreateOrderInput;
    const order = await OrderService.createOrder(requireCartIdentity(req), input);
    sendSuccess(res, 201, order);
  } catch (error) {
    next(error);
  }
}

export async function handleGetGuestOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = parseGuestOrderToken(req.params.token);
    const order = await OrderService.getGuestOrder(token);
    sendSuccess(res, 200, order);
  } catch (error) {
    next(error);
  }
}

export async function handleListCustomerOrders(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const query = customerOrderListQuerySchema.parse(req.query) as CustomerOrderListQuery;
    const result = await OrderService.listCustomerOrders(requireCustomerId(req), query);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleGetCustomerOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orderId = parseOrderId(req.params.orderId);
    const order = await OrderService.getCustomerOrder(requireCustomerId(req), orderId);
    sendSuccess(res, 200, order);
  } catch (error) {
    next(error);
  }
}

// Customer self-service cancellation of an unfinished `pending` Order. Body is
// deliberately empty — the Order is identified by the path id and owned by the
// session. Returns the resulting Order detail (200), matching handleGetCustomerOrder.
export async function handleCancelCustomerOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orderId = parseOrderId(req.params.orderId);
    const order = await OrderService.cancelPendingOrder(requireCustomerId(req), orderId);
    sendSuccess(res, 200, order);
  } catch (error) {
    next(error);
  }
}

// Guest equivalent of handleCancelCustomerOrder — authorized by the opaque
// recovery token in the path, exactly like handleGetGuestOrder. Returns the
// guest-safe Order detail (no shipping coordinates).
export async function handleCancelGuestOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = parseGuestOrderToken(req.params.token);
    const order = await OrderService.cancelPendingGuestOrder(token);
    sendSuccess(res, 200, order);
  } catch (error) {
    next(error);
  }
}

// Binary response — deliberately not sendSuccess()'s {success,data} JSON
// envelope. Ownership is entirely enforced by ReceiptService/OrderService
// (OrderNotFoundError on any mismatch, same as handleGetCustomerOrder above)
// before any PDF is ever rendered.
export async function handleDownloadCustomerReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const orderId = parseOrderId(req.params.orderId);
    const { buffer, filename } = await ReceiptService.generateForCustomer(requireCustomerId(req), orderId);
    res.status(200).setHeader("Content-Type", "application/pdf").setHeader("Content-Disposition", `attachment; filename="${filename}"`).send(buffer);
  } catch (error) {
    next(error);
  }
}

export async function handleDownloadGuestReceipt(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = parseGuestOrderToken(req.params.token);
    const { buffer, filename } = await ReceiptService.generateForGuest(token);
    res.status(200).setHeader("Content-Type", "application/pdf").setHeader("Content-Disposition", `attachment; filename="${filename}"`).send(buffer);
  } catch (error) {
    next(error);
  }
}
