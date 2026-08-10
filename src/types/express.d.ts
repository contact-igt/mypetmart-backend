import type { User, AuthSession } from "../database/tables/index.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: User;
      session?: AuthSession;
    }
  }
}

declare module "http" {
  interface IncomingMessage {
    requestId?: string;
  }
}

export {};
