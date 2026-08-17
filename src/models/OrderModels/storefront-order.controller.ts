import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import type { CartIdentity } from "../CartModels/cart.types.js";
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
