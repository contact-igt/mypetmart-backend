import type { Request, Response } from "express";

import { sendError, sendSuccess } from "../../utils/api-response.js";
import { getHealthStatus, getReadinessStatus } from "./health.service.js";

export function getHealthController(_request: Request, response: Response): void {
  sendSuccess(response, 200, getHealthStatus());
}

export async function getReadinessController(_request: Request, response: Response): Promise<void> {
  const readinessStatus = await getReadinessStatus();

  if (readinessStatus === undefined) {
    sendError(response, 503, "SERVICE_NOT_READY", "The service is not ready.");
    return;
  }

  sendSuccess(response, 200, readinessStatus);
}
