import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { ServiceabilityService } from "./serviceability.service.js";
import { deliveryCheckSchema } from "./serviceability.validation.js";

export async function handleStorefrontDeliveryCheck(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = deliveryCheckSchema.parse(req.body);
    const result = await ServiceabilityService.checkForProduct(input);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}
