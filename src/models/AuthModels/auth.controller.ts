import type { Request, Response, NextFunction } from "express";
import type { ZodError } from "zod";
import { authConfig } from "../../config/auth.config.js";
import { environmentConfig } from "../../config/environment.config.js";
import { CookieService } from "../../services/auth/cookie.service.js";
import { SessionService } from "../../services/auth/session.service.js";
import { TokenService } from "../../services/auth/token.service.js";
import { sendSuccess } from "../../utils/api-response.js";
import { AuthService } from "./auth.service.js";
import { ValidationError, SessionInvalidError } from "./auth.errors.js";
import { ApplicationError } from "../../utils/application-error.js";
import {
  SignupSchema,
  SigninSchema,
  VerifyEmailSchema,
  ResendVerificationSchema,
  ForgotPasswordSchema,
  VerifyResetOTPSchema,
  ResetPasswordSchema
} from "./auth.validation.js";
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

export const AuthController = {
  async signup(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = SignupSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const signupResult = await AuthService.signup(result.data);

      if ("verificationRequired" in signupResult) {
        sendSuccess(res, 200, signupResult);
        return;
      }

      CookieService.setRefreshCookie(res, signupResult.refreshToken, "customer");
      sendSuccess(res, 201, { user: toSafeUserJSON(signupResult.user), accessToken: signupResult.accessToken });
    } catch (error) {
      next(error);
    }
  },

  async signin(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = SigninSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const userAgent = req.headers["user-agent"] || null;
      const ipAddress = req.ip || null;

      const signinResult = await AuthService.signin(result.data, userAgent, ipAddress);

      if ("verificationRequired" in signinResult) {
        sendSuccess(res, 200, signinResult);
        return;
      }

      CookieService.setRefreshCookie(res, signinResult.refreshToken, "customer");
      sendSuccess(res, 200, { user: toSafeUserJSON(signinResult.user), accessToken: signinResult.accessToken });
    } catch (error) {
      next(error);
    }
  },

  async verifyEmail(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = VerifyEmailSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const userAgent = req.headers["user-agent"] || null;
      const ipAddress = req.ip || null;

      const { user, accessToken, refreshToken } = await AuthService.verifyEmail(
        result.data.challengeId,
        result.data.otp,
        userAgent,
        ipAddress
      );

      CookieService.setRefreshCookie(res, refreshToken, "customer");
      sendSuccess(res, 200, { user: toSafeUserJSON(user), accessToken });
    } catch (error) {
      next(error);
    }
  },

  async resendVerification(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = ResendVerificationSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const recoveryToken = req.cookies["mypetmart_recovery"];
      if (recoveryToken) {
        const jwt = (await import("jsonwebtoken")).default;
        let payload: { challengeId?: number; isDecoy: boolean };
        try {
          payload = jwt.verify(recoveryToken, authConfig.accessSecret, {
            issuer: authConfig.issuer,
            algorithms: ["HS256"]
          }) as typeof payload;
        } catch {
          const resendResult = await AuthService.resendVerification(result.data);
          sendSuccess(res, 200, resendResult);
          return;
        }

        if (payload.isDecoy) {
          sendSuccess(res, 200, {
            message: "If an account exists for this email, a verification code has been sent."
          });
          return;
        }

        const { AuthChallenge, User } = await import("../../database/tables/index.js");
        const challenge = await AuthChallenge.findByPk(payload.challengeId);
        if (!challenge) {
          throw new ApplicationError({
            statusCode: 400,
            code: "AUTH_CHALLENGE_INVALID",
            message: "Verification request parameters invalid or user not found."
          });
        }

        const user = await User.findByPk(challenge.user_id);
        if (!user) {
          throw new ApplicationError({
            statusCode: 400,
            code: "AUTH_CHALLENGE_INVALID",
            message: "Verification request parameters invalid or user not found."
          });
        }

        const { authChallengeService } = await import("../../services/auth-challenge/auth-challenge.service.js");
        const newChallenge = await authChallengeService.createOrResendChallenge(user.id, user.email, "password_reset");
        
        const newPayload: { challengeId?: number; isDecoy: boolean; generatedOtpForTest?: string } = {
          challengeId: newChallenge.challengeId,
          isDecoy: false
        };
        if (environmentConfig.NODE_ENV === "test" && newChallenge.generatedOtpForTest) {
          newPayload.generatedOtpForTest = newChallenge.generatedOtpForTest;
        }
        const newRecoveryToken = jwt.sign(
          newPayload,
          authConfig.accessSecret,
          { expiresIn: "15m", issuer: authConfig.issuer }
        );
        CookieService.setRecoveryCookie(res, newRecoveryToken);

        sendSuccess(res, 200, {
          message: "If an account exists for this email, a verification code has been sent."
        });
        return;
      }

      const resendResult = await AuthService.resendVerification(result.data);
      sendSuccess(res, 200, resendResult);
    } catch (error) {
      next(error);
    }
  },

  async forgotPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = ForgotPasswordSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const forgotResult = await AuthService.forgotPassword(result.data.email);
      
      const jwt = (await import("jsonwebtoken")).default;
      const payload: { challengeId?: number; isDecoy: boolean; generatedOtpForTest?: string } = {
        isDecoy: forgotResult.isDecoy
      };
      if (forgotResult.challengeId !== undefined) {
        payload.challengeId = forgotResult.challengeId;
      }
      if (environmentConfig.NODE_ENV === "test" && forgotResult.generatedOtpForTest) {
        payload.generatedOtpForTest = forgotResult.generatedOtpForTest;
      }
      const recoveryToken = jwt.sign(
        payload,
        authConfig.accessSecret,
        { expiresIn: "15m", issuer: authConfig.issuer }
      );

      CookieService.setRecoveryCookie(res, recoveryToken);

      sendSuccess(res, 200, {
        message: "If an account exists for this email, a verification code has been sent."
      });
    } catch (error) {
      next(error);
    }
  },

  async verifyResetOTP(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = VerifyResetOTPSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const recoveryToken = req.cookies["mypetmart_recovery"];
      if (!recoveryToken) {
        throw new ApplicationError({
          statusCode: 400,
          code: "AUTH_CHALLENGE_INVALID",
          message: "The verification code is invalid or expired."
        });
      }

      let payload: { challengeId?: number; isDecoy: boolean };
      try {
        const jwt = (await import("jsonwebtoken")).default;
        payload = jwt.verify(recoveryToken, authConfig.accessSecret, {
          issuer: authConfig.issuer,
          algorithms: ["HS256"]
        }) as typeof payload;
      } catch {
        throw new ApplicationError({
          statusCode: 400,
          code: "AUTH_CHALLENGE_INVALID",
          message: "The verification code is invalid or expired."
        });
      }

      if (payload.isDecoy || !payload.challengeId) {
        throw new ApplicationError({
          statusCode: 400,
          code: "AUTH_CHALLENGE_INVALID",
          message: "The verification code is invalid or expired."
        });
      }

      const { userId, rawToken } = await AuthService.verifyResetOTP(payload.challengeId, result.data.otp);
      const cookiePayload = JSON.stringify({ userId, token: rawToken });

      CookieService.clearRecoveryCookie(res);
      CookieService.setResetCookie(res, cookiePayload);
      sendSuccess(res, 200, { resetTokenGranted: true });
    } catch (error) {
      next(error);
    }
  },

  async resetPassword(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const result = ResetPasswordSchema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(parseZodErrors(result.error));
      }

      const cookieName = environmentConfig.PASSWORD_RESET_COOKIE_NAME;
      const resetCookie = req.cookies[cookieName];

      if (!resetCookie) {
        throw new ApplicationError({
          statusCode: 400,
          code: "AUTH_RESET_TOKEN_INVALID",
          message: "Password reset session expired or invalid."
        });
      }

      let parsedCookie: { userId: number; token: string };
      try {
        parsedCookie = typeof resetCookie === "string" ? JSON.parse(resetCookie) : resetCookie;
      } catch {
        throw new ApplicationError({
          statusCode: 400,
          code: "AUTH_RESET_TOKEN_INVALID",
          message: "Password reset session corrupt."
        });
      }

      await AuthService.resetPassword(parsedCookie.userId, parsedCookie.token, result.data.password);

      CookieService.clearResetCookie(res);
      CookieService.clearRefreshCookie(res, "customer");
      sendSuccess(res, 200, { passwordReset: true });
    } catch (error) {
      next(error);
    }
  },

  async refresh(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cookieName = authConfig.customerRefreshCookieName;
      const oldRefreshToken = req.cookies[cookieName];
      if (!oldRefreshToken) {
        throw new SessionInvalidError();
      }

      const userAgent = req.headers["user-agent"] || null;
      const ipAddress = req.ip || null;

      const { session, newRefreshToken } = await SessionService.rotateSession(
        oldRefreshToken,
        "customer",
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
        sessionType: "customer"
      });

      CookieService.setRefreshCookie(res, newRefreshToken, "customer");
      sendSuccess(res, 200, { accessToken });
    } catch (error: unknown) {
      const errCode = error instanceof Error && "code" in error && typeof (error as { code?: unknown }).code === "string"
        ? (error as { code: string }).code
        : undefined;
      if (
        errCode === "AUTH_SESSION_INVALID" ||
        errCode === "AUTH_SESSION_REVOKED" ||
        errCode === "AUTH_TOKEN_INVALID" ||
        errCode === "AUTH_TOKEN_EXPIRED"
      ) {
        CookieService.clearRefreshCookie(res, "customer");
      }
      next(error);
    }
  },

  async logout(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const cookieName = authConfig.customerRefreshCookieName;
      const refreshToken = req.cookies[cookieName];

      if (refreshToken) {
        await SessionService.revokeSession(refreshToken, "customer");
      }

      CookieService.clearRefreshCookie(res, "customer");
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
