import type { Response } from "express";
import { authConfig } from "../../config/auth.config.js";
import { environmentConfig } from "../../config/environment.config.js";

function parseDurationToMs(duration: string): number {
  const match = duration.match(/^(\d+)([dhm])$/);
  if (!match) return 30 * 24 * 60 * 60 * 1000;
  const val = parseInt(match[1]!, 10);
  const unit = match[2]!;
  switch (unit) {
    case "d": return val * 24 * 60 * 60 * 1000;
    case "h": return val * 60 * 60 * 1000;
    case "m": return val * 60 * 1000;
    default: return 30 * 24 * 60 * 60 * 1000;
  }
}

export const CookieService = {
  setRefreshCookie(res: Response, token: string, sessionType: "customer" | "admin"): void {
    const isProduction = environmentConfig.NODE_ENV === "production";
    const cookieName = sessionType === "admin" ? authConfig.adminRefreshCookieName : authConfig.customerRefreshCookieName;
    const path = sessionType === "admin" ? "/api/v1/admin/auth" : "/api/v1/auth";
    const maxAge = parseDurationToMs(authConfig.refreshTokenExpiresIn);

    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path,
      maxAge
    });
  },

  clearRefreshCookie(res: Response, sessionType: "customer" | "admin"): void {
    const isProduction = environmentConfig.NODE_ENV === "production";
    const cookieName = sessionType === "admin" ? authConfig.adminRefreshCookieName : authConfig.customerRefreshCookieName;
    const path = sessionType === "admin" ? "/api/v1/admin/auth" : "/api/v1/auth";

    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path
    });
  },

  setResetCookie(res: Response, token: string): void {
    const isProduction = environmentConfig.NODE_ENV === "production";
    const cookieName = environmentConfig.PASSWORD_RESET_COOKIE_NAME;
    const path = "/api/v1/auth";
    const maxAge = environmentConfig.PASSWORD_RESET_TOKEN_TTL_SECONDS * 1000;

    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path,
      maxAge
    });
  },

  clearResetCookie(res: Response): void {
    const isProduction = environmentConfig.NODE_ENV === "production";
    const cookieName = environmentConfig.PASSWORD_RESET_COOKIE_NAME;
    const path = "/api/v1/auth";

    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path
    });
  },

  setRecoveryCookie(res: Response, token: string): void {
    const isProduction = environmentConfig.NODE_ENV === "production";
    const cookieName = "mypetmart_recovery";
    const path = "/api/v1/auth";
    const maxAge = 15 * 60 * 1000; // 15 minutes

    res.cookie(cookieName, token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path,
      maxAge
    });
  },

  clearRecoveryCookie(res: Response): void {
    const isProduction = environmentConfig.NODE_ENV === "production";
    const cookieName = "mypetmart_recovery";
    const path = "/api/v1/auth";

    res.clearCookie(cookieName, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path
    });
  }
};
