import { Router } from "express";

import { getHealthController } from "./health.controller.js";

export const healthRouter = Router();

healthRouter.get("/health", getHealthController);
