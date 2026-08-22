import type { NextFunction, Request, Response } from "express";
import type { ZodError } from "zod";
import { ValidationError } from "../AuthModels/auth.errors.js";
import { sendSuccess } from "../../utils/api-response.js";
import { ContactService } from "./contact.service.js";
import {
  CreateContactEnquirySchema,
  ListAdminContactEnquiriesQuerySchema,
  UpdateContactEnquirySchema,
  parseContactEnquiryId
} from "./contact.validation.js";

function parseZodErrors(error: ZodError): Record<string, string[]> {
  const formatted: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const pathKey = issue.path.join(".") || "body";
    if (!formatted[pathKey]) {
      formatted[pathKey] = [];
    }
    formatted[pathKey].push(issue.message);
  }
  return formatted;
}

export class StorefrontContactController {
  public static async createEnquiry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = CreateContactEnquirySchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const enquiry = await ContactService.createEnquiry(result.data);
      sendSuccess(res, 201, enquiry);
    } catch (error) {
      next(error);
    }
  }
}

export class AdminContactController {
  public static async listEnquiries(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = ListAdminContactEnquiriesQuerySchema.safeParse(req.query);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const enquiries = await ContactService.listAdminContactEnquiries(result.data);
      sendSuccess(res, 200, enquiries);
    } catch (error) {
      next(error);
    }
  }

  public static async getEnquiryById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseContactEnquiryId(req.params.enquiryId);
      const enquiry = await ContactService.getAdminContactEnquiryById(id);
      sendSuccess(res, 200, enquiry);
    } catch (error) {
      next(error);
    }
  }

  public static async updateEnquiry(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const id = parseContactEnquiryId(req.params.enquiryId);
      const result = UpdateContactEnquirySchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const enquiry = await ContactService.updateAdminContactEnquiry(id, result.data);
      sendSuccess(res, 200, enquiry);
    } catch (error) {
      next(error);
    }
  }
}
