import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminAttachImage,
  handleAdminDeleteImage,
  handleAdminReorderImages,
  handleAdminUpdateImage
} from "./product-image.controller.js";

export const adminImageRouter = Router();

adminImageRouter.use(authenticate("admin"));

adminImageRouter.post("/:productId/images", (req, res, next) => {
  void handleAdminAttachImage(req, res, next);
});

adminImageRouter.patch("/:productId/images/reorder", (req, res, next) => {
  void handleAdminReorderImages(req, res, next);
});

adminImageRouter.patch("/:productId/images/:imageId", (req, res, next) => {
  void handleAdminUpdateImage(req, res, next);
});

adminImageRouter.delete("/:productId/images/:imageId", (req, res, next) => {
  void handleAdminDeleteImage(req, res, next);
});
