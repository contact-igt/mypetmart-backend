import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminCreateVariant,
  handleAdminDeleteVariant,
  handleAdminReorderVariants,
  handleAdminUpdateVariant
} from "./product-variant.controller.js";

export const adminVariantRouter = Router();

adminVariantRouter.use(authenticate("admin"));

adminVariantRouter.post("/:productId/variants", (req, res, next) => {
  void handleAdminCreateVariant(req, res, next);
});

adminVariantRouter.patch("/:productId/variants/reorder", (req, res, next) => {
  void handleAdminReorderVariants(req, res, next);
});

adminVariantRouter.patch("/:productId/variants/:variantId", (req, res, next) => {
  void handleAdminUpdateVariant(req, res, next);
});

adminVariantRouter.delete("/:productId/variants/:variantId", (req, res, next) => {
  void handleAdminDeleteVariant(req, res, next);
});
