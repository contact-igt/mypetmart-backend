import type { Request, Response } from "express";

import { sendSuccess } from "../../utils/api-response.js";
import { getHealthStatus } from "./health.service.js";

export function getHealthController(_request: Request, response: Response): void {
  sendSuccess(response, 200, getHealthStatus());
}
