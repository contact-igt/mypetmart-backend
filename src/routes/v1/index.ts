import { Router } from "express";

import { healthRouter } from "../../models/HealthModels/health.routes.js";

export const v1Router = Router();

v1Router.use(healthRouter);
