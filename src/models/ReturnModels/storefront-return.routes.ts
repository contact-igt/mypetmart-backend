import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { handleCreateReturnRequest, handleGetCustomerReturn, handleListCustomerReturns } from "./storefront-return.controller.js";

export const storefrontReturnRouter = Router();

// Guest Returns are explicitly deferred (see return.types.ts / the Returns +
// Refunds report §22) — every route here is customer-session-only, unlike
// storefront-order.routes.ts which carves out guest paths before this gate.
storefrontReturnRouter.use(authenticate("customer"));

storefrontReturnRouter.post("/", (req, res, next) => {
  void handleCreateReturnRequest(req, res, next);
});

storefrontReturnRouter.get("/", (req, res, next) => {
  void handleListCustomerReturns(req, res, next);
});

storefrontReturnRouter.get("/:returnId", (req, res, next) => {
  void handleGetCustomerReturn(req, res, next);
});
