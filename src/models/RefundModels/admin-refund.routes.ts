import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { authorize } from "../../middlewares/auth/authorize.middleware.js";
import { handleAdminInitiateRefund, handleAdminRecheckRefund } from "./admin-refund.controller.js";

// Mounted at /admin (routes/v1/index.ts) — deliberately broader than
// adminReturnRouter's /admin/returns prefix so this router can also own
// /admin/refunds/:refundId/recheck without a second top-level mount. Every
// route here is gated to super_admin specifically — refund initiation is a
// real-money action, kept more tightly restricted than Return review
// (adminReturnRouter, admin OR super_admin) per the spec's recommended
// default RBAC split (§30), using authorize.middleware.ts's previously
// unused role-gating hook.
export const adminRefundRouter = Router();

adminRefundRouter.use(authenticate("admin"), authorize("super_admin"));

adminRefundRouter.post("/returns/:returnId/refunds", (req, res, next) => {
  void handleAdminInitiateRefund(req, res, next);
});

adminRefundRouter.post("/refunds/:refundId/recheck", (req, res, next) => {
  void handleAdminRecheckRefund(req, res, next);
});
