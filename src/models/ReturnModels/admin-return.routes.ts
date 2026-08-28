import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { handleAdminAddReturnNote, handleAdminCreateReturnShipment, handleAdminGetReturn, handleAdminListReturns, handleAdminMarkItemReceived, handleAdminReviewReturn, handleAdminUpdateReplacement } from "./admin-return.controller.js";

export const adminReturnRouter = Router();

adminReturnRouter.use(authenticate("admin"));

adminReturnRouter.get("/", (req, res, next) => {
  void handleAdminListReturns(req, res, next);
});

adminReturnRouter.get("/:returnId", (req, res, next) => {
  void handleAdminGetReturn(req, res, next);
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

adminReturnRouter.post("/:returnId/create-shipment", (req, res, next) => {
  void handleAdminCreateReturnShipment(req, res, next);
});
