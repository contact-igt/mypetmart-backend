import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { PaymentService } from "./payment.service.js";
import { initiatePaymentSchema } from "./payment.validation.js";
import type { ConfirmCodOrderInput, InitiatePaymentInput, PaymentInitiationCaller } from "./payment.types.js";

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

// Breeze online payment: prepares a provider:"breeze" Payment Attempt and
// returns server-authoritative values for the storefront's
// sendOTP -> verifyOTP -> startPayment SDK calls. Same auth shape / caller
// resolution as /initiate. Never trusts a client-supplied amount.
export async function handleInitiateBreezeCheckout(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = initiatePaymentSchema.parse(req.body) as InitiatePaymentInput;
    const result = await PaymentService.initiateBreezeCheckout(resolveCaller(req), input);
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

// Same exactly-one-of-orderId/guestAccessToken shape as /initiate — reuses
// initiatePaymentSchema rather than a parallel schema (Phase 1 COD scope).
export async function handleConfirmCodOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const input = initiatePaymentSchema.parse(req.body) as ConfirmCodOrderInput;
    const result = await PaymentService.confirmCodOrder(resolveCaller(req), input);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}
