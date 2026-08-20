import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { NewsletterService } from "./newsletter.service.js";
import { resendUnsubscribeLinkSchema, subscribeSchema, unsubscribeSchema, verifySchema } from "./newsletter.validation.js";

export const NewsletterController = {
  async subscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = subscribeSchema.parse(req.body);
      const result = await NewsletterService.subscribe(input);
      sendSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  },

  async verify(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = verifySchema.parse(req.body);
      const result = await NewsletterService.verify(input.token);
      sendSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  },

  async unsubscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = unsubscribeSchema.parse(req.body);
      const result = await NewsletterService.unsubscribe(input.token);
      sendSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  },

  async resendUnsubscribeLink(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const input = resendUnsubscribeLinkSchema.parse(req.body);
      const result = await NewsletterService.resendUnsubscribeLink(input.email);
      sendSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  }
};
