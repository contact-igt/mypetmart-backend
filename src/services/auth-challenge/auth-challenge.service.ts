import crypto from "node:crypto";
import { environmentConfig } from "../../config/environment.config.js";
import type { AuthChallengePurpose } from "../../constants/database.constants.js";
import { AuthChallenge } from "../../database/tables/AuthChallengeTable/index.js";
import { PasswordResetToken } from "../../database/tables/PasswordResetTokenTable/index.js";
import { ApplicationError } from "../../utils/application-error.js";
import type { Transaction, FindOptions, SaveOptions, CreateOptions } from "sequelize";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { emailService } from "../email/email.service.js";

export function maskEmail(email: string): string {
  const [localPart = "", domainPart = ""] = email.trim().toLowerCase().split("@");
  if (localPart.length <= 2) {
    return `${localPart}***@${domainPart}`;
  }
  return `${localPart.substring(0, 2)}***@${domainPart}`;
}

export function generateNumericOTP(): string {
  return crypto.randomInt(100000, 1000000).toString();
}

export function computeOTPHash(otp: string): string {
  return crypto.createHmac("sha256", environmentConfig.AUTH_OTP_HMAC_SECRET).update(otp.trim()).digest("hex");
}

export function computeTokenHash(token: string): string {
  return crypto.createHash("sha256").update(token.trim()).digest("hex");
}

export class AuthChallengeService {
  public async getActiveChallengeOrResend(
    userId: number,
    email: string,
    purpose: AuthChallengePurpose,
    transaction?: Transaction
  ): Promise<{ challengeId: number; maskedEmail: string; resendAvailableAt: Date; generatedOtpForTest?: string | undefined }> {
    const options: FindOptions = {
      where: { user_id: userId, purpose, consumed_at: null }
    };
    if (transaction) {
      options.transaction = transaction;
    }
    const existingChallenge = await AuthChallenge.findOne(options);

    const now = new Date();

    // Only return the existing challenge silently (without a new email) when:
    //   1. The OTP has not yet expired (expires_at > now), AND
    //   2. The resend cooldown is still active (resend_available_at > now)
    // If the cooldown has passed, fall through to createOrResendChallenge so a
    // new OTP is generated and a new email is dispatched.
    if (
      existingChallenge &&
      existingChallenge.expires_at > now &&
      existingChallenge.resend_available_at > now
    ) {
      return {
        challengeId: existingChallenge.id,
        maskedEmail: maskEmail(email),
        resendAvailableAt: existingChallenge.resend_available_at
      };
    }

    return await this.createOrResendChallenge(userId, email, purpose, transaction);
  }

  public async createOrResendChallenge(
    userId: number,
    email: string,
    purpose: AuthChallengePurpose,
    transaction?: Transaction
  ): Promise<{ challengeId: number; maskedEmail: string; resendAvailableAt: Date; generatedOtpForTest?: string | undefined }> {
    const options: FindOptions = {
      where: { user_id: userId, purpose, consumed_at: null }
    };
    if (transaction) {
      options.transaction = transaction;
    }
    const existingChallenge = await AuthChallenge.findOne(options);

    const now = new Date();

    if (existingChallenge && existingChallenge.resend_available_at > now) {
      const waitSeconds = Math.ceil((existingChallenge.resend_available_at.getTime() - now.getTime()) / 1000);
      throw new ApplicationError({
        statusCode: 400,
        code: "AUTH_OTP_RESEND_TOO_SOON",
        message: `Please wait ${waitSeconds} seconds before requesting another code.`
      });
    }

    const otp = generateNumericOTP();
    const codeHash = computeOTPHash(otp);
    const expiresAt = new Date(now.getTime() + environmentConfig.AUTH_OTP_TTL_SECONDS * 1000);
    const resendAvailableAt = new Date(now.getTime() + environmentConfig.AUTH_OTP_RESEND_COOLDOWN_SECONDS * 1000);

    let challenge: AuthChallenge;

    if (existingChallenge) {
      existingChallenge.code_hash = codeHash;
      existingChallenge.expires_at = expiresAt;
      existingChallenge.resend_available_at = resendAvailableAt;
      existingChallenge.attempt_count = 0;
      existingChallenge.max_attempts = environmentConfig.AUTH_OTP_MAX_ATTEMPTS;
      const saveOptions: SaveOptions = {};
      if (transaction) {
        saveOptions.transaction = transaction;
      }
      await existingChallenge.save(saveOptions);
      challenge = existingChallenge;
    } else {
      // Allocate next sequence ID inside the transaction
      let allocatedId: number;
      if (transaction) {
        allocatedId = await IdSequenceService.allocateNextId("auth_challenges", transaction);
      } else {
        // Fallback for safety if not in a transaction (though transaction is recommended)
        const { sequelize } = await import("../../database/index.js");
        allocatedId = await sequelize.transaction(async (t) => {
          return await IdSequenceService.allocateNextId("auth_challenges", t);
        });
      }

      const createOptions: CreateOptions = {};
      if (transaction) {
        createOptions.transaction = transaction;
      }
      challenge = await AuthChallenge.create({
        id: allocatedId,
        user_id: userId,
        purpose,
        code_hash: codeHash,
        expires_at: expiresAt,
        resend_available_at: resendAvailableAt,
        max_attempts: environmentConfig.AUTH_OTP_MAX_ATTEMPTS,
        attempt_count: 0,
        consumed_at: null
      }, createOptions);
    }

    const ttlMinutes = Math.round(environmentConfig.AUTH_OTP_TTL_SECONDS / 60);

    let emailSent: boolean;
    if (purpose === "email_verification") {
      emailSent = await emailService.sendVerificationOTP(email, otp, ttlMinutes);
    } else {
      emailSent = await emailService.sendPasswordResetOTP(email, otp, ttlMinutes);
    }

    if (!emailSent && environmentConfig.NODE_ENV !== "test") {
      throw new ApplicationError({
        statusCode: 502,
        code: "EMAIL_DELIVERY_FAILED",
        message: "We couldn't send the verification email. Please try again later."
      });
    }

    const result: { challengeId: number; maskedEmail: string; resendAvailableAt: Date; generatedOtpForTest?: string | undefined } = {
      challengeId: challenge.id,
      maskedEmail: maskEmail(email),
      resendAvailableAt: challenge.resend_available_at
    };

    if (environmentConfig.NODE_ENV === "test") {
      result.generatedOtpForTest = otp;
    }

    return result;
  }

  public async verifyOTPChallenge(
    challengeId: number,
    otp: string,
    purpose: AuthChallengePurpose,
    transaction?: Transaction
  ): Promise<AuthChallenge> {
    const options: FindOptions = {
      where: { id: challengeId, purpose }
    };
    if (transaction) {
      options.transaction = transaction;
    }
    const challenge = await AuthChallenge.findOne(options);

    if (!challenge) {
      throw new ApplicationError({
        statusCode: 400,
        code: "AUTH_CHALLENGE_INVALID",
        message: "Invalid or expired verification challenge."
      });
    }

    if (challenge.consumed_at !== null) {
      throw new ApplicationError({
        statusCode: 400,
        code: "AUTH_OTP_EXPIRED",
        message: "Verification code has already been used."
      });
    }

    const now = new Date();
    if (challenge.expires_at < now) {
      throw new ApplicationError({
        statusCode: 400,
        code: "AUTH_OTP_EXPIRED",
        message: "Verification code has expired. Please request a new code."
      });
    }

    if (challenge.attempt_count >= challenge.max_attempts) {
      throw new ApplicationError({
        statusCode: 429,
        code: "AUTH_OTP_ATTEMPTS_EXCEEDED",
        message: "Maximum verification attempts exceeded. Please request a new code."
      });
    }

    const inputHash = computeOTPHash(otp);
    const hashMatches = crypto.timingSafeEqual(Buffer.from(inputHash, "hex"), Buffer.from(challenge.code_hash, "hex"));

    if (!hashMatches) {
      challenge.attempt_count += 1;
      const saveOptions: SaveOptions = {};
      if (transaction) {
        saveOptions.transaction = transaction;
      }
      await challenge.save(saveOptions);

      if (challenge.attempt_count >= challenge.max_attempts) {
        throw new ApplicationError({
          statusCode: 429,
          code: "AUTH_OTP_ATTEMPTS_EXCEEDED",
          message: "Maximum verification attempts exceeded. Please request a new code."
        });
      }

      throw new ApplicationError({
        statusCode: 400,
        code: "AUTH_OTP_INVALID",
        message: "Invalid verification code. Please check and try again."
      });
    }

    challenge.consumed_at = now;
    const saveOptions: SaveOptions = {};
    if (transaction) {
      saveOptions.transaction = transaction;
    }
    await challenge.save(saveOptions);

    return challenge;
  }

  public async generatePasswordResetToken(
    userId: number,
    transaction?: Transaction
  ): Promise<{ rawToken: string; tokenHash: string; expiresAt: Date }> {
    const rawToken = crypto.randomBytes(32).toString("hex");
    const tokenHash = computeTokenHash(rawToken);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + environmentConfig.PASSWORD_RESET_TOKEN_TTL_SECONDS * 1000);

    let allocatedId: number;
    if (transaction) {
      allocatedId = await IdSequenceService.allocateNextId("password_reset_tokens", transaction);
    } else {
      const { sequelize } = await import("../../database/index.js");
      allocatedId = await sequelize.transaction(async (t) => {
        return await IdSequenceService.allocateNextId("password_reset_tokens", t);
      });
    }

    const createOptions: CreateOptions = {};
    if (transaction) {
      createOptions.transaction = transaction;
    }
    await PasswordResetToken.create({
      id: allocatedId,
      user_id: userId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      consumed_at: null
    }, createOptions);

    return { rawToken, tokenHash, expiresAt };
  }

  public async verifyAndConsumeResetToken(
    userId: number,
    rawToken: string,
    transaction?: Transaction
  ): Promise<boolean> {
    const tokenHash = computeTokenHash(rawToken);
    const options: FindOptions = {
      where: { user_id: userId, token_hash: tokenHash, consumed_at: null }
    };
    if (transaction) {
      options.transaction = transaction;
    }
    const tokenRecord = await PasswordResetToken.findOne(options);

    if (!tokenRecord) {
      throw new ApplicationError({
        statusCode: 400,
        code: "AUTH_RESET_TOKEN_INVALID",
        message: "Invalid or expired password reset token."
      });
    }

    const now = new Date();
    if (tokenRecord.expires_at < now) {
      throw new ApplicationError({
        statusCode: 400,
        code: "AUTH_RESET_TOKEN_EXPIRED",
        message: "Password reset session has expired. Please start over."
      });
    }

    tokenRecord.consumed_at = now;
    const saveOptions: SaveOptions = {};
    if (transaction) {
      saveOptions.transaction = transaction;
    }
    await tokenRecord.save(saveOptions);

    return true;
  }
}

export const authChallengeService = new AuthChallengeService();
