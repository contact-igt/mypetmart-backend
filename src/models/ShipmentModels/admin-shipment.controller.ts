import type { NextFunction, Request, Response } from "express";

import { shippingConfig } from "../../config/shipping.config.js";
import { sendSuccess } from "../../utils/api-response.js";
import { ShipmentService } from "./shipment.service.js";
import { parseShipmentId, reattemptSchema, rtoSchema, shipmentListQuerySchema } from "./shipment.validation.js";

export async function handleListShipments(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, 200, await ShipmentService.list(shipmentListQuerySchema.parse(req.query))); } catch (error) { next(error); }
}
export async function handleGetShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, 200, await ShipmentService.getById(parseShipmentId(req.params.shipmentId))); } catch (error) { next(error); }
}
export async function handleCreateOrderShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, 200, await ShipmentService.createForOrder(parseShipmentId(req.params.orderId))); } catch (error) { next(error); }
}
export async function handleCreateReplacementShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, 200, await ShipmentService.createForReplacement(parseShipmentId(req.params.replacementId))); } catch (error) { next(error); }
}
export async function handleRefreshShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, 200, await ShipmentService.refresh(parseShipmentId(req.params.shipmentId))); } catch (error) { next(error); }
}
export async function handleCancelShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, 200, await ShipmentService.cancel(parseShipmentId(req.params.shipmentId))); } catch (error) { next(error); }
}
export async function handleReattemptShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, 200, await ShipmentService.reattempt(parseShipmentId(req.params.shipmentId), reattemptSchema.parse(req.body))); } catch (error) { next(error); }
}
export async function handleRtoShipment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try { sendSuccess(res, 200, await ShipmentService.requestRto(parseShipmentId(req.params.shipmentId), rtoSchema.parse(req.body))); } catch (error) { next(error); }
}
export function handleShippingConfig(_req: Request, res: Response): void {
  sendSuccess(res, 200, { provider: shippingConfig.provider, configured: shippingConfig.ready, warehouseId: shippingConfig.pickupAddressId ?? null, environment: shippingConfig.apiBaseUrl.includes("pre-alpha") ? "staging" : "production" });
}
