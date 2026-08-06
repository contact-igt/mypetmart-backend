import { randomUUID } from "node:crypto";

import type { NextFunction, Request, Response } from "express";

import { APPLICATION_CONSTANTS } from "../../constants/application.constants.js";

const MAX_CLIENT_REQUEST_ID_LENGTH = 80;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

function isSafeClientRequestId(value: string): boolean {
  return value.length > 0 && value.length <= MAX_CLIENT_REQUEST_ID_LENGTH && REQUEST_ID_PATTERN.test(value);
}

function getClientRequestId(request: Request): string | undefined {
  const headerValue = request.header(APPLICATION_CONSTANTS.requestIdHeader);

  if (headerValue === undefined) {
    return undefined;
  }

  const trimmedValue = headerValue.trim();

  return isSafeClientRequestId(trimmedValue) ? trimmedValue : undefined;
}

export function requestIdMiddleware(request: Request, response: Response, next: NextFunction): void {
  request.requestId = getClientRequestId(request) ?? randomUUID();
  response.setHeader("X-Request-Id", request.requestId);
  next();
}
