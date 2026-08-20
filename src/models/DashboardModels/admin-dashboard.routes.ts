import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { handleAdminGetDashboardFilterOptions, handleAdminGetDashboardSummary } from "./dashboard.controller.js";

export const adminDashboardRouter = Router();

adminDashboardRouter.use(authenticate("admin"));

adminDashboardRouter.get("/summary", (req, res, next) => {
  void handleAdminGetDashboardSummary(req, res, next);
});

adminDashboardRouter.get("/filter-options", (req, res, next) => {
  void handleAdminGetDashboardFilterOptions(req, res, next);
});
