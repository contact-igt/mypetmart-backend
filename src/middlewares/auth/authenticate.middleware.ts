import type { Request, Response, NextFunction } from "express";
import { TokenService } from "../../services/auth/token.service.js";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { AuthSession, User } from "../../database/tables/index.js";
import {
  TokenMissingError,
  TokenInvalidError,
  TokenExpiredError,
  SessionInvalidError,
  SessionRevokedError,
  AccountDisabledError
} from "../../models/AuthModels/auth.errors.js";

export function authenticate(sessionType: "customer" | "admin") {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new TokenMissingError();
      }

      const token = authHeader.substring(7).trim();
      if (!token) {
        throw new TokenMissingError();
      }

      let payload;
      try {
        payload = TokenService.verifyAccessToken(token, sessionType);
      } catch (error: unknown) {
        if (error instanceof Error && error.name === "TokenExpiredError") {
          throw new TokenExpiredError();
        }
        throw new TokenInvalidError();
      }

      if (payload.sessionType !== sessionType) {
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
        where: { id: parsedSessionId, session_type: sessionType },
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

      // Check role constraints based on sessionType
      if (sessionType === "admin" && user.role !== "admin" && user.role !== "super_admin") {
        throw new TokenInvalidError();
      }
      if (sessionType === "customer" && user.role !== "customer") {
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
