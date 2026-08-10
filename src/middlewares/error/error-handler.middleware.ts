import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

import { ApplicationError } from "../../utils/application-error.js";
import { sendError } from "../../utils/api-response.js";
import { logger } from "../../utils/logger.js";

import { ValidationError } from "../../models/AuthModels/auth.errors.js";

const INTERNAL_ERROR_MESSAGE = "An unexpected error occurred.";
const PAYLOAD_TOO_LARGE_MESSAGE = "The request body is too large.";
const MALFORMED_JSON_MESSAGE = "The request body contains malformed JSON.";

type BodyParserError = Error & {
  status?: number;
  statusCode?: number;
  type?: string;
};

function isBodyParserError(error: unknown): error is BodyParserError {
  return error instanceof Error && ("type" in error || "status" in error || "statusCode" in error);
}

function toApplicationError(error: unknown): ApplicationError {
  if (error instanceof ApplicationError) {
    return error;
  }

  if (error instanceof ZodError) {
    const formatted: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const field = issue.path.join(".") || "body";
      if (!formatted[field]) formatted[field] = [];
      formatted[field].push(issue.message);
    }
    return new ValidationError(formatted);
  }

  if (isBodyParserError(error)) {
    if (error.type === "entity.parse.failed") {
      return new ApplicationError({
        statusCode: 400,
        code: "MALFORMED_JSON",
        message: MALFORMED_JSON_MESSAGE
      });
    }

    if (error.type === "entity.too.large" || error.status === 413 || error.statusCode === 413) {
      return new ApplicationError({
        statusCode: 413,
        code: "PAYLOAD_TOO_LARGE",
        message: PAYLOAD_TOO_LARGE_MESSAGE
      });
    }
  }

  return new ApplicationError({
    statusCode: 500,
    code: "INTERNAL_ERROR",
    message: INTERNAL_ERROR_MESSAGE,
    details: error,
    isOperational: false
  });
}

export const errorHandlerMiddleware: ErrorRequestHandler = (error, request, response, _next) => {
  const applicationError = toApplicationError(error);

  if (!applicationError.isOperational) {
    logger.error(
      {
        err: error,
        requestId: request.requestId,
        method: request.method,
        path: request.path
      },
      "Unexpected application error"
    );
  }

  const errors = applicationError instanceof ValidationError ? applicationError.errors : undefined;
  sendError(response, applicationError.statusCode, applicationError.code, applicationError.publicMessage, errors);
};
