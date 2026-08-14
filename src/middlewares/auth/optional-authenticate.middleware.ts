import type { Request, Response, NextFunction } from "express";

import { TokenService } from "../../services/auth/token.service.js";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { AuthSession, User } from "../../database/tables/index.js";
import { TokenExpiredError, TokenInvalidError, SessionInvalidError, SessionRevokedError, AccountDisabledError } from "../../models/AuthModels/auth.errors.js";

/**
 * Resolves an optional customer identity without hard-failing when
 * unauthenticated: a valid customer Bearer token sets req.user; an
 * invalid/expired one still rejects (401) rather than silently downgrading
 * to guest; no Authorization header at all simply calls next() with
 * req.user left unset, for routes (like Payment Initiation) that must accept
 * both a signed-in customer and a guest.
 *
 * This intentionally re-verifies the token the same way
 * authenticate.middleware.ts and resolve-cart-identity.middleware.ts already
 * do, rather than sharing that block — the codebase's own existing
 * precedent (resolve-cart-identity.middleware.ts already duplicates this
 * exact verification instead of importing authenticate.middleware.ts) is
 * followed here rather than introducing a new shared abstraction that would
 * touch those already-verified files.
 */
export function optionalAuthenticate() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        next();
        return;
      }

      const token = authHeader.substring(7).trim();
      if (!token) {
        throw new TokenInvalidError();
      }

      let payload;
      try {
        payload = TokenService.verifyAccessToken(token, "customer");
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "TokenExpiredError") {
          throw new TokenExpiredError();
        }
        throw new TokenInvalidError();
      }

      if (payload.sessionType !== "customer") {
        throw new TokenInvalidError();
      }

      let parsedSessionId: number;
      try {
        parsedSessionId = parseStrictIdClaim(payload.sessionId);
        parseStrictIdClaim(payload.sub);
      } catch {
        throw new TokenInvalidError();
      }

      const session = await AuthSession.findOne({
        where: { id: parsedSessionId, session_type: "customer" },
        include: [{ model: User, as: "user" }]
      });

      if (!session) {
        throw new SessionInvalidError();
      }
      if (session.revoked_at !== null) {
        throw new SessionRevokedError();
      }
      if (new Date(session.expires_at) < new Date()) {
        throw new SessionInvalidError();
      }

      const user = session.user;
      if (!user) {
        throw new SessionInvalidError();
      }
      if (user.status !== "active") {
        throw new AccountDisabledError();
      }
      if (user.role !== "customer") {
        throw new TokenInvalidError();
      }

      req.user = user;
      req.session = session;
      next();
    } catch (error) {
      next(error);
    }
  };
}
