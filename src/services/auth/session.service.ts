import crypto from "node:crypto";
import type { Transaction } from "sequelize";
import { authConfig } from "../../config/auth.config.js";
import { sequelize } from "../../database/index.js";
import { AuthSession, User } from "../../database/tables/index.js";
import { TokenService, type RefreshTokenPayload } from "./token.service.js";
import { parseStrictIdClaim } from "../../utils/claim-parser.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import {
  SessionInvalidError,
  SessionRevokedError,
  AccountDisabledError,
  TokenExpiredError
} from "../../models/AuthModels/auth.errors.js";

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

function getExpiryDate(): Date {
  const ms = parseDurationToMs(authConfig.refreshTokenExpiresIn);
  return new Date(Date.now() + ms);
}

export const SessionService = {
  async createSession(
    userId: number,
    sessionType: "customer" | "admin",
    userAgent: string | null,
    ipAddress: string | null,
    transaction?: Transaction
  ): Promise<{ session: AuthSession; refreshToken: string }> {
    const execute = async (t: Transaction) => {
      const tempTokenHash = `TEMP-${crypto.randomUUID()}`;
      const expiresAt = getExpiryDate();

      const allocatedId = await IdSequenceService.allocateNextId("auth_sessions", t);

      const session = await AuthSession.create(
        {
          id: allocatedId,
          user_id: userId,
          session_type: sessionType,
          token_hash: tempTokenHash,
          user_agent: userAgent,
          ip_address: ipAddress,
          expires_at: expiresAt,
          revoked_at: null
        },
        { transaction: t }
      );

      const sessionId = String(session.id);
      const refreshToken = TokenService.generateRefreshToken({ sessionId, sessionType });
      const tokenHash = TokenService.hashToken(refreshToken);

      await session.update({ token_hash: tokenHash }, { transaction: t });

      return { session, refreshToken };
    };

    if (transaction) {
      return await execute(transaction);
    } else {
      return await sequelize.transaction(async (t) => {
        return await execute(t);
      });
    }
  },

  async rotateSession(
    oldRefreshToken: string,
    sessionType: "customer" | "admin",
    userAgent: string | null,
    ipAddress: string | null
  ): Promise<{ session: AuthSession; newRefreshToken: string }> {
    // 1. Verify token signature/claims (throws if signature invalid, issuer/audience mismatch, or expired)
    let payload: RefreshTokenPayload;
    try {
      payload = TokenService.verifyRefreshToken(oldRefreshToken, sessionType);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === "TokenExpiredError") {
        throw new TokenExpiredError();
      }
      throw new SessionInvalidError();
    }

    let parsedSessionId: number;
    try {
      parsedSessionId = parseStrictIdClaim(payload.sessionId);
    } catch {
      throw new SessionInvalidError();
    }

    const oldTokenHash = TokenService.hashToken(oldRefreshToken);

    // 2. Rotate inside a transaction with lock to prevent race conditions
    return await sequelize.transaction(async (t) => {
      const session = await AuthSession.findOne({
        where: { id: parsedSessionId, token_hash: oldTokenHash, session_type: sessionType },
        include: [{ model: User, as: "user" }],
        lock: t.LOCK.UPDATE,
        transaction: t
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
        throw new SessionInvalidError();
      }
      if (sessionType === "customer" && user.role !== "customer") {
        throw new SessionInvalidError();
      }

      // Generate new tokens
      const newRefreshToken = TokenService.generateRefreshToken({
        sessionId: String(session.id),
        sessionType
      });
      const newTokenHash = TokenService.hashToken(newRefreshToken);
      const newExpiresAt = getExpiryDate();

      // Update session row
      await session.update(
        {
          token_hash: newTokenHash,
          expires_at: newExpiresAt,
          user_agent: userAgent || session.user_agent,
          ip_address: ipAddress || session.ip_address
        },
        { transaction: t }
      );

      return { session, newRefreshToken };
    });
  },

  async revokeSession(refreshToken: string, sessionType: "customer" | "admin"): Promise<void> {
    try {
      TokenService.verifyRefreshToken(refreshToken, sessionType);
    } catch {
      // Return safely even if token is invalid or expired
      return;
    }

    const tokenHash = TokenService.hashToken(refreshToken);
    const session = await AuthSession.findOne({
      where: { token_hash: tokenHash, session_type: sessionType }
    });

    if (session && session.revoked_at === null) {
      await session.update({ revoked_at: new Date() });
    }
  }
};
