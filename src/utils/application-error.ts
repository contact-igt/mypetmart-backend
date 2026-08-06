export type ApplicationErrorOptions = {
  statusCode: number;
  code: string;
  message: string;
  details?: unknown;
  isOperational?: boolean;
};

export class ApplicationError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly publicMessage: string;
  public readonly details?: unknown;
  public readonly isOperational: boolean;

  public constructor(options: ApplicationErrorOptions) {
    super(options.message);
    this.name = "ApplicationError";
    this.statusCode = options.statusCode;
    this.code = options.code;
    this.publicMessage = options.message;
    this.details = options.details;
    this.isOperational = options.isOperational ?? true;
  }
}
