import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { NewsletterService } from "./newsletter.service.js";
import { listSubscribersQuerySchema } from "./newsletter.validation.js";

export const AdminNewsletterController = {
  async listSubscribers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = listSubscribersQuerySchema.parse(req.query);
      const result = await NewsletterService.listSubscribers(query);
      sendSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  }
};
