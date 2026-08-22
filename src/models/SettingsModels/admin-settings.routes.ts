import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { authorize } from "../../middlewares/auth/authorize.middleware.js";
import {
  handleAdminGetIntegrationsStatus,
  handleAdminGetStoreProfile,
  handleAdminListAdminUsers,
  handleAdminUpdateStoreProfile
} from "./settings.controller.js";

// Store profile, integration connection status and the admin-user roster are
// all sensitive/ops-facing — gated to super_admin only, the same tighter
// default RefundModels uses for real-money actions (see admin-refund.routes.ts).
export const adminSettingsRouter = Router();

adminSettingsRouter.use(authenticate("admin"), authorize("super_admin"));

adminSettingsRouter.get("/store", (req, res, next) => {
  void handleAdminGetStoreProfile(req, res, next);
});

adminSettingsRouter.patch("/store", (req, res, next) => {
  void handleAdminUpdateStoreProfile(req, res, next);
});

adminSettingsRouter.get("/integrations", (req, res, next) => {
  handleAdminGetIntegrationsStatus(req, res, next);
});

adminSettingsRouter.get("/admins", (req, res, next) => {
  void handleAdminListAdminUsers(req, res, next);
});
