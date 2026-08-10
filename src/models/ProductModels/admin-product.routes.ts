import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminBulkDeleteProducts,
  handleAdminBulkUpdateStatus,
  handleAdminCreateProduct,
  handleAdminDeleteProduct,
  handleAdminDuplicateProduct,
  handleAdminGetProductById,
  handleAdminGetProductSummary,
  handleAdminListProducts,
  handleAdminUpdateProduct,
  handleAdminUpdateProductStatus
} from "./product.controller.js";

export const adminProductRouter = Router();

adminProductRouter.use(authenticate("admin"));

// Static routes FIRST to avoid being trapped by /:productId
adminProductRouter.get("/", (req, res, next) => {
  void handleAdminListProducts(req, res, next);
});

adminProductRouter.post("/", (req, res, next) => {
  void handleAdminCreateProduct(req, res, next);
});

adminProductRouter.patch("/bulk-status", (req, res, next) => {
  void handleAdminBulkUpdateStatus(req, res, next);
});

adminProductRouter.post("/bulk-delete", (req, res, next) => {
  void handleAdminBulkDeleteProducts(req, res, next);
});

adminProductRouter.get("/summary", (req, res, next) => {
  void handleAdminGetProductSummary(req, res, next);
});

// Dynamic product ID routes
adminProductRouter.get("/:productId", (req, res, next) => {
  void handleAdminGetProductById(req, res, next);
});

adminProductRouter.patch("/:productId", (req, res, next) => {
  void handleAdminUpdateProduct(req, res, next);
});

adminProductRouter.patch("/:productId/status", (req, res, next) => {
  void handleAdminUpdateProductStatus(req, res, next);
});

adminProductRouter.delete("/:productId", (req, res, next) => {
  void handleAdminDeleteProduct(req, res, next);
});

adminProductRouter.post("/:productId/duplicate", (req, res, next) => {
  void handleAdminDuplicateProduct(req, res, next);
});
