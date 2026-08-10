import { sequelize } from "../../database/index.js";
import { User, AuthSession } from "../../database/tables/index.js";
import { PasswordService } from "../../services/auth/password.service.js";
import { SessionService } from "../../services/auth/session.service.js";
import { TokenService } from "../../services/auth/token.service.js";
import { authChallengeService } from "../../services/auth-challenge/auth-challenge.service.js";
import { emailService } from "../../services/email/email.service.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import {
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  AccountDisabledError
} from "./auth.errors.js";
import { ApplicationError } from "../../utils/application-error.js";
import type { SignupPayload, SigninPayload } from "./auth.types.js";

export type SignupResult =
  | { verificationRequired: true; challengeId: number; maskedEmail: string; resendAvailableAt: Date; generatedOtpForTest?: string | undefined }
  | { user: User; session: AuthSession; accessToken: string; refreshToken: string };

export type SigninResult =
  | { verificationRequired: true; challengeId: number; maskedEmail: string; resendAvailableAt: Date; generatedOtpForTest?: string | undefined }
  | { user: User; session: AuthSession; accessToken: string; refreshToken: string };

export const AuthService = {
  async signup(payload: SignupPayload): Promise<SignupResult> {
    const email = payload.email.trim().toLowerCase();
    const name = payload.name.trim();

    const existingUser = await User.findOne({ where: { email } });
    if (existingUser) {
      if (existingUser.email_verified_at === null) {
        // During cooldown window: return existing active challenge so the frontend
        // can show verificationRequired without generating a duplicate OTP email.
        // After cooldown: a new OTP is generated and emailed automatically.
        const challenge = await authChallengeService.getActiveChallengeOrResend(
          existingUser.id,
          existingUser.email,
          "email_verification"
        );
        return {
          verificationRequired: true,
          challengeId: challenge.challengeId,
          maskedEmail: challenge.maskedEmail,
          resendAvailableAt: challenge.resendAvailableAt,
          generatedOtpForTest: challenge.generatedOtpForTest
        };
      }
      throw new EmailAlreadyExistsError();
    }

    const passwordHash = await PasswordService.hash(payload.password);

    const user = await sequelize.transaction(async (t) => {
      const allocatedId = await IdSequenceService.allocateNextId("users", t);
      const referenceCode = buildBusinessReference("customer", allocatedId);

      return await User.create({
        id: allocatedId,
        name,
        email,
        phone: payload.phone || null,
        password_hash: passwordHash,
        role: "customer",
        status: "active",
        email_verified_at: null,
        reference_code: referenceCode
      }, { transaction: t });
    });

    const challenge = await authChallengeService.createOrResendChallenge(
      user.id,
      user.email,
      "email_verification"
    );

    return {
      verificationRequired: true,
      challengeId: challenge.challengeId,
      maskedEmail: challenge.maskedEmail,
      resendAvailableAt: challenge.resendAvailableAt,
      generatedOtpForTest: challenge.generatedOtpForTest
    };
  },

  async signin(
    payload: SigninPayload,
    userAgent: string | null,
    ipAddress: string | null
  ): Promise<SigninResult> {
    const email = payload.email.trim().toLowerCase();

    const user = await User.findOne({ where: { email } });
    if (!user) {
      throw new InvalidCredentialsError();
    }

    if (user.role !== "customer") {
      throw new InvalidCredentialsError();
    }

    if (user.status !== "active") {
      throw new AccountDisabledError();
    }

    const isPasswordValid = await PasswordService.verify(payload.password, user.password_hash);
    if (!isPasswordValid) {
      throw new InvalidCredentialsError();
    }

    if (user.email_verified_at === null) {
      const challenge = await authChallengeService.getActiveChallengeOrResend(
        user.id,
        user.email,
        "email_verification"
      );
      return {
        verificationRequired: true,
        challengeId: challenge.challengeId,
        maskedEmail: challenge.maskedEmail,
        resendAvailableAt: challenge.resendAvailableAt,
        generatedOtpForTest: challenge.generatedOtpForTest
      };
    }

    return await sequelize.transaction(async (t) => {
      await user.update({ last_login_at: new Date() }, { transaction: t });

      const { session, refreshToken } = await SessionService.createSession(
        user.id,
        "customer",
        userAgent,
        ipAddress,
        t
      );

      const accessToken = TokenService.generateAccessToken({
        sub: String(user.id),
        sessionId: String(session.id),
        role: user.role,
        sessionType: "customer"
      });

      return { user, session, accessToken, refreshToken };
    });
  },

  async verifyEmail(
    challengeId: number,
    otp: string,
    userAgent: string | null,
    ipAddress: string | null
  ): Promise<{ user: User; session: AuthSession; accessToken: string; refreshToken: string }> {
    const challenge = await authChallengeService.verifyOTPChallenge(challengeId, otp, "email_verification");
    const user = await User.findByPk(challenge.user_id);

    if (!user) {
      throw new ApplicationError({
        statusCode: 404,
        code: "AUTH_CHALLENGE_INVALID",
        message: "User account not found."
      });
    }

    return await sequelize.transaction(async (t) => {
      const now = new Date();
      await user.update({ email_verified_at: now, last_login_at: now }, { transaction: t });

      const { session, refreshToken } = await SessionService.createSession(
        user.id,
        "customer",
        userAgent,
        ipAddress,
        t
      );

      const accessToken = TokenService.generateAccessToken({
        sub: String(user.id),
        sessionId: String(session.id),
        role: user.role,
        sessionType: "customer"
      });

      return { user, session, accessToken, refreshToken };
    });
  },

  async resendVerification(payload: { challengeId?: number | undefined; email?: string | undefined }): Promise<{ challengeId: number; maskedEmail: string; resendAvailableAt: Date; generatedOtpForTest?: string | undefined }> {
    let userId: number | undefined;
    let userEmail: string | undefined;

    if (payload.challengeId) {
      const { AuthChallenge } = await import("../../database/tables/index.js");
      const challenge = await AuthChallenge.findByPk(payload.challengeId);
      if (challenge) {
        userId = challenge.user_id;
        const user = await User.findByPk(userId);
        if (user) {
          userEmail = user.email;
        }
      }
    } else if (payload.email) {
      const email = payload.email.trim().toLowerCase();
      const user = await User.findOne({ where: { email, role: "customer" } });
      if (user) {
        userId = user.id;
        userEmail = user.email;
      }
    }

    if (!userId || !userEmail) {
      throw new ApplicationError({
        statusCode: 400,
        code: "AUTH_CHALLENGE_INVALID",
        message: "Verification request parameters invalid or user not found."
      });
    }

    const user = await User.findByPk(userId);
    if (user && user.email_verified_at !== null) {
      throw new ApplicationError({
        statusCode: 400,
        code: "AUTH_EMAIL_ALREADY_VERIFIED",
        message: "Email address is already verified."
      });
    }

    return await authChallengeService.createOrResendChallenge(userId, userEmail, "email_verification");
  },

  async forgotPassword(email: string): Promise<{ success: boolean; challengeId?: number; isDecoy: boolean; generatedOtpForTest?: string | undefined }> {
    const { maskEmail } = await import("../../services/auth-challenge/auth-challenge.service.js");
    const { logger } = await import("../../utils/logger.js");

    const cleanEmail = email.trim().toLowerCase();
    const user = await User.findOne({ where: { email: cleanEmail } });

    if (!user || user.role !== "customer") {
      return {
        success: true,
        isDecoy: true
      };
    }

    try {
      const challenge = await authChallengeService.createOrResendChallenge(user.id, user.email, "password_reset");
      return {
        success: true,
        challengeId: challenge.challengeId,
        isDecoy: false,
        generatedOtpForTest: challenge.generatedOtpForTest
      };
    } catch (error) {
      logger.error({ error, email: maskEmail(cleanEmail) }, "Forgot password challenge creation/email failed internally");
      return {
        success: true,
        isDecoy: true
      };
    }
  },

  async verifyResetOTP(challengeId: number, otp: string): Promise<{ userId: number; rawToken: string }> {
    const challenge = await authChallengeService.verifyOTPChallenge(challengeId, otp, "password_reset");
    const { rawToken } = await authChallengeService.generatePasswordResetToken(challenge.user_id);
    return { userId: challenge.user_id, rawToken };
  },

  async resetPassword(userId: number, rawToken: string, newPassword: string): Promise<boolean> {
    await authChallengeService.verifyAndConsumeResetToken(userId, rawToken);

    const user = await User.findByPk(userId);
    if (!user) {
      throw new ApplicationError({
        statusCode: 404,
        code: "AUTH_RESET_TOKEN_INVALID",
        message: "User account not found."
      });
    }

    const passwordHash = await PasswordService.hash(newPassword);

    await sequelize.transaction(async (t) => {
      await user.update({ password_hash: passwordHash }, { transaction: t });
      await AuthSession.update({ revoked_at: new Date() }, { where: { user_id: userId, revoked_at: null }, transaction: t });
    });

    await emailService.sendPasswordChangedNotification(user.email);
    return true;
  },

  async adminSignin(
    payload: SigninPayload,
    userAgent: string | null,
    ipAddress: string | null
  ): Promise<{ user: User; session: AuthSession; accessToken: string; refreshToken: string }> {
    const email = payload.email.trim().toLowerCase();

    const user = await User.findOne({ where: { email } });
    if (!user) {
      throw new InvalidCredentialsError();
    }

    if (user.role !== "admin" && user.role !== "super_admin") {
      throw new InvalidCredentialsError();
    }

    if (user.status !== "active") {
      throw new AccountDisabledError();
    }

    const isPasswordValid = await PasswordService.verify(payload.password, user.password_hash);
    if (!isPasswordValid) {
      throw new InvalidCredentialsError();
    }

    return await sequelize.transaction(async (t) => {
      await user.update({ last_login_at: new Date() }, { transaction: t });

      const { session, refreshToken } = await SessionService.createSession(
        user.id,
        "admin",
        userAgent,
        ipAddress,
        t
      );

      const accessToken = TokenService.generateAccessToken({
        sub: String(user.id),
        sessionId: String(session.id),
        role: user.role,
        sessionType: "admin"
      });

      return { user, session, accessToken, refreshToken };
    });
  }
};
