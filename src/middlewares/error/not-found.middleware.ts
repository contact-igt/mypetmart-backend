import type { NextFunction, Request, Response } from "express";

import { ApplicationError } from "../../utils/application-error.js";

export function notFoundMiddleware(_request: Request, _response: Response, next: NextFunction): void {
  next(
    new ApplicationError({
      statusCode: 404,
      code: "NOT_FOUND",
      message: "The requested resource was not found."
    })
  );
}
