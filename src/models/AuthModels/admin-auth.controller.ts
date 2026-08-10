import type { Request, Response, NextFunction } from "express";
import type { ZodError } from "zod";
import { authConfig } from "../../config/auth.config.js";
import { CookieService } from "../../services/auth/cookie.service.js";
import { SessionService } from "../../services/auth/session.service.js";
import { TokenService } from "../../services/auth/token.service.js";
import { sendSuccess } from "../../utils/api-response.js";
import { AuthService } from "./auth.service.js";
import { ValidationError, SessionInvalidError } from "./auth.errors.js";
import { SigninSchema } from "./auth.validation.js";
import { toSafeUserJSON } from "./auth.types.js";

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */

function parseZodErrors(error: ZodError): Record<string, string[]> {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path.join(".") || "body";
    if (!errors[field]) {
      errors[field] = [];
    }
    errors[field].push(issue.message);
  }
  return errors;
}

export const AdminAuthController = {
  async signin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = SigninSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const userAgent = req.headers["user-agent"] || null;
      const ipAddress = req.ip || null;

      const { user, accessToken, refreshToken } = await AuthService.adminSignin(
        result.data,
        userAgent,
        ipAddress
      );

      CookieService.setRefreshCookie(res, refreshToken, "admin");
      sendSuccess(res, 200, { user: toSafeUserJSON(user), accessToken });
    } catch (error) {
      next(error);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cookieName = authConfig.adminRefreshCookieName;
      const oldRefreshToken = req.cookies[cookieName];
      if (!oldRefreshToken) {
        throw new SessionInvalidError();
      }

      const userAgent = req.headers["user-agent"] || null;
      const ipAddress = req.ip || null;

      const { session, newRefreshToken } = await SessionService.rotateSession(
        oldRefreshToken,
        "admin",
        userAgent,
        ipAddress
      );

      const user = session.user;
      if (!user) {
        throw new SessionInvalidError();
      }

      const accessToken = TokenService.generateAccessToken({
        sub: String(user.id),
        sessionId: String(session.id),
        role: user.role,
        sessionType: "admin"
      });

      CookieService.setRefreshCookie(res, newRefreshToken, "admin");
      sendSuccess(res, 200, { accessToken });
    } catch (error) {
      next(error);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cookieName = authConfig.adminRefreshCookieName;
      const refreshToken = req.cookies[cookieName];

      if (refreshToken) {
        await SessionService.revokeSession(refreshToken, "admin");
      }

      CookieService.clearRefreshCookie(res, "admin");
      sendSuccess(res, 200, null);
    } catch (error) {
      next(error);
    }
  },

  me(req: Request, res: Response, next: NextFunction): void {
    try {
      if (!req.user) {
        throw new SessionInvalidError();
      }
      sendSuccess(res, 200, toSafeUserJSON(req.user));
    } catch (error) {
      next(error);
    }
  }
};
