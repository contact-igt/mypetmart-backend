import type { NextFunction, Request, Response } from "express";
import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { authorize } from "../../middlewares/auth/authorize.middleware.js";
import { sendSuccess } from "../../utils/api-response.js";
import { listBreezeAdminActions, listBreezeReconciliation, releaseBreezeCheckoutAsStaff, retryBreezeEventAsStaff } from "./breeze-reconciliation.service.js";

// Staff Breeze reconciliation API. Mounted at /api/v1/admin/breeze.
// - Reads and manual retry: admin or super_admin.
// - Releasing an unresolved checkout (unblocks a customer): super_admin only.
// Every mutation requires a reason and writes an audit row (service layer).

export const adminBreezeRouter = Router();

adminBreezeRouter.use(authenticate("admin"), authorize("admin", "super_admin"));

function actorId(req: Request): number {
  if (!req.user) throw new Error("Admin identity was not resolved before reaching the controller.");
  return req.user.id;
}

function parseId(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw Object.assign(new Error("Invalid identifier."), { statusCode: 400, code: "INVALID_ID", isOperational: true });
  }
  return id;
}

adminBreezeRouter.get("/reconciliation", (req: Request, res: Response, next: NextFunction) => {
  listBreezeReconciliation()
    .then((data) => sendSuccess(res, 200, data))
    .catch(next);
});

adminBreezeRouter.get("/actions", (req: Request, res: Response, next: NextFunction) => {
  listBreezeAdminActions()
    .then((data) => sendSuccess(res, 200, data))
    .catch(next);
});

adminBreezeRouter.post("/events/:eventRef/retry", (req: Request, res: Response, next: NextFunction) => {
  const body = (req.body ?? {}) as { reason?: unknown };
  retryBreezeEventAsStaff(parseId(String(req.params.eventRef)), actorId(req), body.reason)
    .then((data) => sendSuccess(res, 200, data))
    .catch(next);
});

// Release is a stronger action: super_admin only.
adminBreezeRouter.post("/sessions/:checkoutRef/release", authorize("super_admin"), (req: Request, res: Response, next: NextFunction) => {
  const body = (req.body ?? {}) as { reason?: unknown; confirmation?: unknown };
  releaseBreezeCheckoutAsStaff(parseId(String(req.params.checkoutRef)), actorId(req), body.reason, body.confirmation)
    .then((data) => sendSuccess(res, 200, data))
    .catch(next);
});
