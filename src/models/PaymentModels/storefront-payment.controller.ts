import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { PaymentService } from "./payment.service.js";
import { initiatePaymentSchema } from "./payment.validation.js";
import type { InitiatePaymentInput, PaymentInitiationCaller } from "./payment.types.js";

function resolveCaller(req: Request): PaymentInitiationCaller {
  // Set by optionalAuthenticate() ahead of this route when a valid customer
  // Bearer token was presented; left unset for a guest request.
  return req.user ? { type: "customer", userId: req.user.id } : { type: "guest" };
}

export async function handleInitiatePayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = initiatePaymentSchema.parse(req.body) as InitiatePaymentInput;
    const result = await PaymentService.initiatePayuCheckout(resolveCaller(req), input);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

export async function handleGetPaymentStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = initiatePaymentSchema.parse(req.body) as InitiatePaymentInput;
    const result = await PaymentService.getPaymentStatus(resolveCaller(req), input);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}
