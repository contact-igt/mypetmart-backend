declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

declare module "http" {
  interface IncomingMessage {
    requestId?: string;
  }
}

export {};
