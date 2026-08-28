import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { handleCancelShipment, handleCreateOrderShipment, handleCreateReplacementShipment, handleGetShipment, handleListShipments, handleQuoteOrderShipment, handleReattemptShipment, handleRefreshShipment, handleRetryShipment, handleRtoShipment, handleShippingConfig } from "./admin-shipment.controller.js";

export const adminShipmentRouter = Router();
adminShipmentRouter.use(authenticate("admin"));
adminShipmentRouter.get("/", (req, res, next) => { void handleListShipments(req, res, next); });
adminShipmentRouter.get("/config", handleShippingConfig);
adminShipmentRouter.post("/orders/:orderId/quote", (req, res, next) => { void handleQuoteOrderShipment(req, res, next); });
adminShipmentRouter.post("/orders/:orderId", (req, res, next) => { void handleCreateOrderShipment(req, res, next); });
adminShipmentRouter.post("/replacements/:replacementId", (req, res, next) => { void handleCreateReplacementShipment(req, res, next); });
adminShipmentRouter.get("/:shipmentId", (req, res, next) => { void handleGetShipment(req, res, next); });
adminShipmentRouter.post("/:shipmentId/refresh-tracking", (req, res, next) => { void handleRefreshShipment(req, res, next); });
adminShipmentRouter.post("/:shipmentId/cancel", (req, res, next) => { void handleCancelShipment(req, res, next); });
adminShipmentRouter.post("/:shipmentId/retry", (req, res, next) => { void handleRetryShipment(req, res, next); });
adminShipmentRouter.post("/:shipmentId/reattempt", (req, res, next) => { void handleReattemptShipment(req, res, next); });
adminShipmentRouter.post("/:shipmentId/rto", (req, res, next) => { void handleRtoShipment(req, res, next); });
