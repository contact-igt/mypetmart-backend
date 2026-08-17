import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { authConfig } from "../../config/auth.config.js";

export interface AccessTokenPayload {
  sub: string;
  sessionId: string;
  role: string;
  sessionType: "customer" | "admin";
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sessionId: string;
  sessionType: "customer" | "admin";
  iss?: string;
  aud?: string;
  iat?: number;
  exp?: number;
}

export const TokenService = {
  generateAccessToken(payload: Omit<AccessTokenPayload, "iss" | "aud" | "iat" | "exp">): string {
    const audience = payload.sessionType === "admin" ? authConfig.adminAudience : authConfig.customerAudience;
    return jwt.sign(payload, authConfig.accessSecret, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      expiresIn: authConfig.accessTokenExpiresIn as any,
      issuer: authConfig.issuer,
      audience
    });
  },

  generateRefreshToken(payload: Omit<RefreshTokenPayload, "iss" | "aud" | "iat" | "exp">): string {
    const audience = payload.sessionType === "admin" ? authConfig.adminAudience : authConfig.customerAudience;
    return jwt.sign(payload, authConfig.refreshSecret, {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      expiresIn: authConfig.refreshTokenExpiresIn as any,
      issuer: authConfig.issuer,
      audience
    });
  },

  verifyAccessToken(token: string, sessionType: "customer" | "admin"): AccessTokenPayload {
    const audience = sessionType === "admin" ? authConfig.adminAudience : authConfig.customerAudience;
    return jwt.verify(token, authConfig.accessSecret, {
      issuer: authConfig.issuer,
      audience,
      algorithms: ["HS256"]
    }) as AccessTokenPayload;
  },

  verifyRefreshToken(token: string, sessionType: "customer" | "admin"): RefreshTokenPayload {
    const audience = sessionType === "admin" ? authConfig.adminAudience : authConfig.customerAudience;
    return jwt.verify(token, authConfig.refreshSecret, {
      issuer: authConfig.issuer,
      audience,
      algorithms: ["HS256"]
    }) as RefreshTokenPayload;
  },

  hashToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
  }
};
