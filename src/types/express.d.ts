import type { User, AuthSession } from "../database/tables/index.js";
import type { CartIdentity } from "../models/CartModels/cart.types.js";

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      user?: User;
      session?: AuthSession;
      cartIdentity?: CartIdentity;
    }
  }
}

declare module "http" {
  interface IncomingMessage {
    requestId?: string;
  }
}

export {};
