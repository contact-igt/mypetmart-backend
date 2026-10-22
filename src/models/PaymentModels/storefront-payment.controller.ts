import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { paymentConfig } from "../../config/payment.config.js";
import { z } from "zod";

import { BreezeOrderCreateService } from "./breeze-order-create.service.js";
import { BreezeCheckoutSessionService } from "./breeze-checkout-session.service.js";
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

// Breeze full 1-Click Checkout: validates the live server Cart, signs it on the
// backend and returns the startCheckout inputs. 404 unless server-enabled.
export async function handleCreateBreezeCheckoutSession(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.cartIdentity) {
      throw new Error("Cart identity was not resolved before reaching the controller.");
    }
    const result = await BreezeCheckoutSessionService.createSession(req.cartIdentity);
    sendSuccess(res, 200, result);
  } catch (error) {
    next(error);
  }
}

// Public, non-secret capability probe so the storefront renders the Breeze
// full-checkout button only when the server has it enabled and configured.
export function handleGetBreezeCheckoutConfig(_req: Request, res: Response): void {
  sendSuccess(res, 200, { enabled: paymentConfig.breeze1ccoReady });
}

const breezeSessionStatusSchema = z.object({ sessionId: z.string().regex(/^[0-9a-f]{32}$/u, "Invalid session.") });

// Server-confirmed state of a Breeze checkout for the browser. Ownership is
// enforced against the cart identity that created the session; the browser SDK
// result is never consulted and never marks anything paid.
export async function handleGetBreezeCheckoutSessionStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!req.cartIdentity) {
      throw new Error("Cart identity was not resolved before reaching the controller.");
    }
    const { sessionId } = breezeSessionStatusSchema.parse(req.body);
    const status = await BreezeOrderCreateService.getSessionStatus(req.cartIdentity, sessionId);
    if (!status) {
      res.status(404).json({ success: false, error: { code: "BREEZE_SESSION_NOT_FOUND", message: "Checkout session not found." } });
      return;
    }
    sendSuccess(res, 200, status);
  } catch (error) {
    next(error);
  }
}
