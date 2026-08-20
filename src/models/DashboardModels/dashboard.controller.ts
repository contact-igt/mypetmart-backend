import type { NextFunction, Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { DashboardService } from "./dashboard.service.js";
import { dashboardSummaryQuerySchema } from "./dashboard.validation.js";
import type { DashboardQuery } from "./dashboard.types.js";

export async function handleAdminGetDashboardFilterOptions(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const options = await DashboardService.getFilterOptions();
    sendSuccess(res, 200, options);
  } catch (error) {
    next(error);
  }
}

export async function handleAdminGetDashboardSummary(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const validated = dashboardSummaryQuerySchema.parse(req.query) as DashboardQuery;
    const summary = await DashboardService.getSummary(validated);
    sendSuccess(res, 200, summary);
  } catch (error) {
    next(error);
  }
}
