import type { Response } from "express";

import { APPLICATION_CONSTANTS } from "../constants/application.constants.js";

type ResponseMeta = {
  requestId: string;
};

type SuccessResponse<TData> = {
  success: true;
  data: TData;
  meta: ResponseMeta;
};

type ErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    errors?: Record<string, string[]>;
    details?: unknown;
  };
  meta: ResponseMeta;
};

function getResponseRequestId(response: Response): string {
  return response.req.requestId ?? APPLICATION_CONSTANTS.serviceName;
}

export function sendSuccess<TData>(response: Response, statusCode: number, data: TData): void {
  const body: SuccessResponse<TData> = {
    success: true,
    data,
    meta: {
      requestId: getResponseRequestId(response)
    }
  };

  response.status(statusCode).json(body);
}

export function sendError(
  response: Response,
  statusCode: number,
  code: string,
  message: string,
  errors?: Record<string, string[]>,
  details?: unknown
): void {
  const body: ErrorResponse = {
    success: false,
    error: {
      code,
      message,
      ...(errors ? { errors } : {}),
      ...(details !== undefined ? { details } : {})
    },
    meta: {
      requestId: getResponseRequestId(response)
    }
  };

  response.status(statusCode).json(body);
}
