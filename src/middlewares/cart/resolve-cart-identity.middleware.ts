import crypto from "node:crypto";

import type { Request, Response, NextFunction } from "express";

import { cartConfig } from "../../config/cart.config.js";
import { environmentConfig } from "../../config/environment.config.js";
import { CART_GUEST_COOKIE_MAX_AGE_MS, CART_GUEST_COOKIE_PATH } from "../../models/CartModels/cart.constants.js";
import { TokenService } from "../../services/auth/token.service.js";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { AuthSession, User } from "../../database/tables/index.js";
import {
  TokenExpiredError,
  TokenInvalidError,
  SessionInvalidError,
  SessionRevokedError,
  AccountDisabledError
} from "../../models/AuthModels/auth.errors.js";

function mintGuestCookie(res: Response): string {
  const rawToken = crypto.randomBytes(32).toString("hex");
  const isProduction = environmentConfig.NODE_ENV === "production";

  res.cookie(cartConfig.guestCookieName, rawToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: CART_GUEST_COOKIE_PATH,
    maxAge: CART_GUEST_COOKIE_MAX_AGE_MS
  });

  return rawToken;
}

/**
 * Reads the guest Cart cookie without minting a new one — used by the merge endpoint,
 * where a missing guest cookie legitimately means "nothing to merge" rather than
 * "create a fresh guest identity."
 */
export function getGuestCartTokenHash(req: Request): string | null {
  const existingCookie = req.cookies?.[cartConfig.guestCookieName] as string | undefined;
  if (!existingCookie || existingCookie.length === 0) {
    return null;
  }
  return TokenService.hashToken(existingCookie);
}

export function clearGuestCartCookie(res: Response): void {
  const isProduction = environmentConfig.NODE_ENV === "production";
  res.clearCookie(cartConfig.guestCookieName, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: CART_GUEST_COOKIE_PATH
  });
}

/**
 * Resolves the caller's Cart identity without hard-failing when unauthenticated:
 * a valid Bearer token resolves to the customer identity; an invalid/expired one
 * still rejects (401) rather than silently downgrading to guest; no token at all
 * resolves to (and lazily mints) a guest identity via an httpOnly cookie.
 */
export function resolveCartIdentity() {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;

      if (authHeader && authHeader.startsWith("Bearer ")) {
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
        req.cartIdentity = { type: "customer", userId: user.id };
        next();
        return;
      }

      const existingCookie = req.cookies?.[cartConfig.guestCookieName] as string | undefined;
      const rawToken = existingCookie && existingCookie.length > 0 ? existingCookie : mintGuestCookie(res);

      req.cartIdentity = { type: "guest", tokenHash: TokenService.hashToken(rawToken) };
      next();
    } catch (error) {
      next(error);
    }
  };
}
