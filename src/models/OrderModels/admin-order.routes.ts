import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminAddOrderNote,
  handleAdminBulkUpdateOrderStatus,
  handleAdminGetOrderById,
  handleAdminGetOrderSummary,
  handleAdminListOrders,
  handleAdminUpdateOrderStatus
} from "./admin-order.controller.js";

export const adminOrderRouter = Router();

adminOrderRouter.use(authenticate("admin"));

// Static routes FIRST to avoid being trapped by /:orderId (matches the
// existing admin-product.routes.ts convention).
adminOrderRouter.get("/", (req, res, next) => {
  void handleAdminListOrders(req, res, next);
});

adminOrderRouter.get("/summary", (req, res, next) => {
  void handleAdminGetOrderSummary(req, res, next);
});

adminOrderRouter.patch("/bulk-status", (req, res, next) => {
  void handleAdminBulkUpdateOrderStatus(req, res, next);
});

// Dynamic order ID routes
adminOrderRouter.get("/:orderId", (req, res, next) => {
  void handleAdminGetOrderById(req, res, next);
});

adminOrderRouter.patch("/:orderId/status", (req, res, next) => {
  void handleAdminUpdateOrderStatus(req, res, next);
});

adminOrderRouter.post("/:orderId/notes", (req, res, next) => {
  void handleAdminAddOrderNote(req, res, next);
});

// Deliberately NOT implemented in V1 (see final report §11-§13):
//   PATCH /:orderId/payment-status  — deferred to the Payment module; Admin
//     must not be able to hand-set payment_status until a real provider is
//     authoritative.
//   PATCH /:orderId/fulfilment      — deferred to the Shipping module.
//   PATCH /:orderId/shipment        — deferred to the Shipping module.
