import { Router } from "express";

import { getHealthController, getReadinessController } from "./health.controller.js";

export const healthRouter = Router();

healthRouter.get("/health", getHealthController);
healthRouter.get("/health/ready", getReadinessController);
