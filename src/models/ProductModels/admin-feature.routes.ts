import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminCreateFeature,
  handleAdminDeleteFeature,
  handleAdminReorderFeatures,
  handleAdminUpdateFeature
} from "./product-feature.controller.js";

export const adminFeatureRouter = Router();

adminFeatureRouter.use(authenticate("admin"));

adminFeatureRouter.post("/:productId/features", (req, res, next) => {
  void handleAdminCreateFeature(req, res, next);
});

adminFeatureRouter.patch("/:productId/features/reorder", (req, res, next) => {
  void handleAdminReorderFeatures(req, res, next);
});

adminFeatureRouter.patch("/:productId/features/:featureId", (req, res, next) => {
  void handleAdminUpdateFeature(req, res, next);
});

adminFeatureRouter.delete("/:productId/features/:featureId", (req, res, next) => {
  void handleAdminDeleteFeature(req, res, next);
});
