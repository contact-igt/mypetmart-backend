import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminCompleteImageUpload,
  handleAdminDeleteImage,
  handleAdminPresignImageUpload,
  handleAdminReorderImages,
  handleAdminUpdateImage
} from "./product-image.controller.js";

export const adminImageRouter = Router();

adminImageRouter.use(authenticate("admin"));

adminImageRouter.post("/:productId/images/uploads/presign", (req, res, next) => {
  void handleAdminPresignImageUpload(req, res, next);
});

adminImageRouter.post("/:productId/images/uploads/complete", (req, res, next) => {
  void handleAdminCompleteImageUpload(req, res, next);
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
