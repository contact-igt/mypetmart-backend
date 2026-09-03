import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { handleAdminAddReturnNote, handleAdminCancelReturn, handleAdminCreateReturnShipment, handleAdminGetReturn, handleAdminListReturns, handleAdminMarkItemReceived, handleAdminQuoteReturnShipment, handleAdminRefreshReturnShipment, handleAdminReviewReturn, handleAdminUpdateReplacement, handleAdminUpdateReturnPickupAddress } from "./admin-return.controller.js";

export const adminReturnRouter = Router();

export const adminReturnShipmentRouter = Router();

adminReturnShipmentRouter.use(authenticate("admin"));

adminReturnShipmentRouter.post("/:shipmentId/refresh", (req, res, next) => {
  void handleAdminRefreshReturnShipment(req, res, next);
});

adminReturnRouter.use(authenticate("admin"));

adminReturnRouter.get("/", (req, res, next) => {
  void handleAdminListReturns(req, res, next);
});

adminReturnRouter.get("/:returnId", (req, res, next) => {
  void handleAdminGetReturn(req, res, next);
});

adminReturnRouter.post("/:returnId/cancel", (req, res, next) => {
  void handleAdminCancelReturn(req, res, next);
});

// Approve/reject a Return request. Open to both admin and super_admin —
// refund *initiation* (a separate, more tightly-gated action) is mounted
// under RefundModels with an additional authorize("super_admin") gate.
adminReturnRouter.patch("/:returnId/review", (req, res, next) => {
  void handleAdminReviewReturn(req, res, next);
});

adminReturnRouter.post("/:returnId/notes", (req, res, next) => {
  void handleAdminAddReturnNote(req, res, next);
});

// Warehouse-side confirmation that the physical item is back — an
// operational fact, not a money movement, so open to any admin (unlike
// refund initiation under RefundModels, which stays super_admin-only).
adminReturnRouter.post("/:returnId/receive", (req, res, next) => {
  void handleAdminMarkItemReceived(req, res, next);
});

adminReturnRouter.patch("/:returnId/replacement", (req, res, next) => {
  void handleAdminUpdateReplacement(req, res, next);
});

// Reverse rate quote for the courier picker — read-only, creates nothing.
adminReturnRouter.post("/:returnId/return-shipment/quote", (req, res, next) => {
  void handleAdminQuoteReturnShipment(req, res, next);
});

// Edit the reverse-pickup address snapshot (return_requests.pickup_*) — never
// the Order's own shipping address.
adminReturnRouter.patch("/:returnId/pickup-address", (req, res, next) => {
  void handleAdminUpdateReturnPickupAddress(req, res, next);
});

adminReturnRouter.post("/:returnId/create-shipment", (req, res, next) => {
  void handleAdminCreateReturnShipment(req, res, next);
});
