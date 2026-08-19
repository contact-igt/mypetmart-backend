import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminCompleteMediaAssetUpload,
  handleAdminDeleteMediaAsset,
  handleAdminGetMediaAsset,
  handleAdminListMediaAssets,
  handleAdminPresignMediaAssetUpload,
  handleAdminUpdateMediaAsset
} from "./media-asset.controller.js";

export const adminMediaRouter = Router();

adminMediaRouter.use(authenticate("admin"));

adminMediaRouter.get("/", (req, res, next) => {
  void handleAdminListMediaAssets(req, res, next);
});

adminMediaRouter.post("/uploads/presign", (req, res, next) => {
  void handleAdminPresignMediaAssetUpload(req, res, next);
});

adminMediaRouter.post("/uploads/complete", (req, res, next) => {
  void handleAdminCompleteMediaAssetUpload(req, res, next);
});

adminMediaRouter.get("/:mediaAssetId", (req, res, next) => {
  void handleAdminGetMediaAsset(req, res, next);
});

adminMediaRouter.patch("/:mediaAssetId", (req, res, next) => {
  void handleAdminUpdateMediaAsset(req, res, next);
});

adminMediaRouter.delete("/:mediaAssetId", (req, res, next) => {
  void handleAdminDeleteMediaAsset(req, res, next);
});
