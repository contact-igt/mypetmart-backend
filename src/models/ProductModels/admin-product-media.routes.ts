import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminCreateMediaAssignment,
  handleAdminDeleteMediaAssignment,
  handleAdminReorderMediaAssignments,
  handleAdminUpdateMediaAssignment
} from "./product-media-assignment.controller.js";

export const adminProductMediaRouter = Router();

adminProductMediaRouter.use(authenticate("admin"));

adminProductMediaRouter.post("/:productId/media", (req, res, next) => {
  void handleAdminCreateMediaAssignment(req, res, next);
});

adminProductMediaRouter.patch("/:productId/media/reorder", (req, res, next) => {
  void handleAdminReorderMediaAssignments(req, res, next);
});

adminProductMediaRouter.patch("/:productId/media/:assignmentId", (req, res, next) => {
  void handleAdminUpdateMediaAssignment(req, res, next);
});

adminProductMediaRouter.delete("/:productId/media/:assignmentId", (req, res, next) => {
  void handleAdminDeleteMediaAssignment(req, res, next);
});
