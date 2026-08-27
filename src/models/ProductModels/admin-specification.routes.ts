import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminCreateSpecification,
  handleAdminDeleteSpecification,
  handleAdminReorderSpecifications,
  handleAdminUpdateSpecification
} from "./product-specification.controller.js";

export const adminSpecificationRouter = Router();

adminSpecificationRouter.use(authenticate("admin"));

adminSpecificationRouter.post("/:productId/specifications", (req, res, next) => {
  void handleAdminCreateSpecification(req, res, next);
});

adminSpecificationRouter.patch("/:productId/specifications/reorder", (req, res, next) => {
  void handleAdminReorderSpecifications(req, res, next);
});

adminSpecificationRouter.patch("/:productId/specifications/:specificationId", (req, res, next) => {
  void handleAdminUpdateSpecification(req, res, next);
});

adminSpecificationRouter.delete("/:productId/specifications/:specificationId", (req, res, next) => {
  void handleAdminDeleteSpecification(req, res, next);
});
