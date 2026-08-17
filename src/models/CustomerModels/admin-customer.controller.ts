import type { Request, Response, NextFunction } from "express";
import { sendSuccess } from "../../utils/api-response.js";
import { CustomerNotFoundError } from "./admin-customer.errors.js";
import { AdminCustomerService } from "./admin-customer.service.js";
import { ListCustomersQuerySchema, parseCustomerId } from "./admin-customer.validation.js";

export const AdminCustomerController = {
  async listCustomers(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const query = ListCustomersQuerySchema.parse(req.query);
      const result = await AdminCustomerService.listCustomers(query);
      sendSuccess(res, 200, result);
    } catch (error) {
      next(error);
    }
  },

  async getCustomerDetail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const customerId = parseCustomerId(req.params.customerId);
      const customer = await AdminCustomerService.getCustomerDetail(customerId);
      if (!customer) {
        throw new CustomerNotFoundError();
      }
      sendSuccess(res, 200, customer);
    } catch (error) {
      next(error);
    }
  }
};
