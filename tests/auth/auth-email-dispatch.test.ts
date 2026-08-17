import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { connectDatabase } from "../../src/database/index.js";
import { User, AuthChallenge, PasswordResetToken, AuthSession } from "../../src/database/tables/index.js";
import { emailService } from "../../src/services/email/email.service.js";
import { PasswordService } from "../../src/services/auth/password.service.js";

describe("Stage 8.7: Email verification and password recovery templates & behavior", () => {
  const customerEmail = "dispatch-customer@example.com";
  const adminEmail = "dispatch-admin@example.com";
  const nonexistentEmail = "dispatch-none@example.com";
  const testPassword = "SecurePassword123!";

  const emailsToClean = [customerEmail, adminEmail, "dispatch-signup@example.com"];

  const cleanupSpecificUsers = async () => {
    const users = await User.findAll({ where: { email: emailsToClean } });
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      await PasswordResetToken.destroy({ where: { user_id: userIds }, force: true });
      await AuthChallenge.destroy({ where: { user_id: userIds }, force: true });
      await AuthSession.destroy({ where: { user_id: userIds }, force: true });
      await User.destroy({ where: { id: userIds }, force: true });
    }
  };

  beforeAll(async () => {
    await connectDatabase();
    await cleanupSpecificUsers();

    const passwordHash = await PasswordService.hash(testPassword);
    
    // Create customer
    await User.create({
      id: 20001,
      name: "Dispatch Customer",
      email: customerEmail,
      phone: "1234567890",
      password_hash: passwordHash,
      role: "customer",
      status: "active",
      email_verified_at: new Date(),
      reference_code: "CUS-020001"
    });

    // Create admin
    await User.create({
      id: 20002,
      name: "Dispatch Admin",
      email: adminEmail,
      phone: "0987654321",
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      email_verified_at: new Date(),
      reference_code: "ADM-020002"
    });
  });

  afterAll(async () => {
    await cleanupSpecificUsers();
  });

  it("1. Email verification signup triggers verification template", async () => {
    const sendSpy = vi.spyOn(emailService, "sendVerificationOTP");
    
    const res = await request(app)
      .post("/api/v1/auth/customer/signup")
      .send({
        name: "New Signup Customer",
        email: "dispatch-signup@example.com",
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(res.status).toBe(200);
    expect(sendSpy).toHaveBeenCalled();
    const args = sendSpy.mock.calls[0];
    expect(args?.[0]).toBe("dispatch-signup@example.com");
    expect(args?.[1]).toHaveLength(6); // OTP length
    expect(args?.[2]).toBe(10); // TTL in minutes
    
    sendSpy.mockRestore();
    await User.destroy({ where: { email: "dispatch-signup@example.com" }, force: true });
  });

  it("2. Real customer forgot-password creates challenge, calls email service with reset template, and gets generic response", async () => {
    const sendResetSpy = vi.spyOn(emailService, "sendPasswordResetOTP");
    
    // Check challenge count before
    const user = await User.findOne({ where: { email: customerEmail } });
    const countBefore = await AuthChallenge.count({ where: { user_id: user!.id, purpose: "password_reset" } });
    expect(countBefore).toBe(0);

    const res = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: customerEmail });

    const body = res.body as {
      success: boolean;
      data: {
        message: string;
        challengeId?: number;
        maskedEmail?: string;
        resendAvailableAt?: string;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe("If an account exists for this email, a verification code has been sent.");
    expect(body.data.challengeId).toBeUndefined();
    expect(body.data.maskedEmail).toBeUndefined();
    expect(body.data.resendAvailableAt).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();
    
    // Check challenge count after
    const countAfter = await AuthChallenge.count({ where: { user_id: user!.id, purpose: "password_reset" } });
    expect(countAfter).toBe(1);

    expect(sendResetSpy).toHaveBeenCalled();
    const args = sendResetSpy.mock.calls[0];
    expect(args?.[0]).toBe(customerEmail);
    expect(args?.[1]).toHaveLength(6);
    expect(args?.[2]).toBe(10);

    sendResetSpy.mockRestore();
  });

  it("3. Nonexistent email creates no challenge, sends no email, but returns equivalent public response shape", async () => {
    const sendResetSpy = vi.spyOn(emailService, "sendPasswordResetOTP");
    
    const countBefore = await AuthChallenge.count();

    const res = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: nonexistentEmail });

    const body = res.body as {
      success: boolean;
      data: {
        message: string;
        challengeId?: number;
        maskedEmail?: string;
        resendAvailableAt?: string;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe("If an account exists for this email, a verification code has been sent.");
    
    expect(body.data.challengeId).toBeUndefined();
    expect(body.data.maskedEmail).toBeUndefined();
    expect(body.data.resendAvailableAt).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();

    const countAfter = await AuthChallenge.count();
    expect(countAfter).toBe(countBefore);

    expect(sendResetSpy).not.toHaveBeenCalled();

    sendResetSpy.mockRestore();
  });

  it("4. Admin email triggers no storefront recovery challenge or email, returning generic response", async () => {
    const sendResetSpy = vi.spyOn(emailService, "sendPasswordResetOTP");
    
    const adminUser = await User.findOne({ where: { email: adminEmail } });
    const countBefore = await AuthChallenge.count({ where: { user_id: adminUser!.id, purpose: "password_reset" } });
    expect(countBefore).toBe(0);

    const res = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: adminEmail });

    const body = res.body as {
      success: boolean;
      data: {
        message: string;
        challengeId?: number;
        maskedEmail?: string;
        resendAvailableAt?: string;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe("If an account exists for this email, a verification code has been sent.");
    expect(body.data.challengeId).toBeUndefined();
    expect(body.data.maskedEmail).toBeUndefined();
    expect(body.data.resendAvailableAt).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();

    const countAfter = await AuthChallenge.count({ where: { user_id: adminUser!.id, purpose: "password_reset" } });
    expect(countAfter).toBe(0);

    expect(sendResetSpy).not.toHaveBeenCalled();

    sendResetSpy.mockRestore();
  });

  it("5. SMTP send failure during forgot-password does not expose failure publicly", async () => {
    const user = await User.findOne({ where: { email: customerEmail } });
    await AuthChallenge.destroy({ where: { user_id: user!.id }, force: true });
    const sendResetSpy = vi.spyOn(emailService, "sendPasswordResetOTP").mockResolvedValueOnce(false);

    const res = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: customerEmail });

    const body = res.body as {
      success: boolean;
      data: {
        message: string;
        challengeId?: number;
        maskedEmail?: string;
        resendAvailableAt?: string;
      };
    };

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.message).toBe("If an account exists for this email, a verification code has been sent.");
    expect(body.data.challengeId).toBeUndefined();
    expect(body.data.maskedEmail).toBeUndefined();
    expect(body.data.resendAvailableAt).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeDefined();

    sendResetSpy.mockRestore();
  });

  it("6. Password reset completion triggers password changed template", async () => {
    const sendChangedSpy = vi.spyOn(emailService, "sendPasswordChangedNotification");

    // Start password reset flow for customer
    const user = await User.findOne({ where: { email: customerEmail } });
    const { computeOTPHash } = await import("../../src/services/auth-challenge/auth-challenge.service.js");
    const codeHash = computeOTPHash("123456");

    const challenge = await AuthChallenge.create({
      id: 20001,
      user_id: user!.id,
      purpose: "password_reset",
      code_hash: codeHash,
      expires_at: new Date(Date.now() + 600000),
      resend_available_at: new Date(Date.now() + 60000),
      attempt_count: 0,
      max_attempts: 5,
      consumed_at: null
    });

    const verifySpy = vi.spyOn(emailService, "sendEmail").mockResolvedValue(true);

    const _verifyRes = await request(app)
      .post("/api/v1/auth/verify-reset-otp")
      .send({
        challengeId: challenge.id,
        otp: "123456"
      });

    // Let's call resetPassword directly to test the changed template triggers
    const { AuthService } = await import("../../src/models/AuthModels/auth.service.js");
    
    // Generate reset token
    const { authChallengeService } = await import("../../src/services/auth-challenge/auth-challenge.service.js");
    const { rawToken } = await authChallengeService.generatePasswordResetToken(user!.id);
    
    // Perform reset
    const resetRes = await AuthService.resetPassword(user!.id, rawToken, "NewUpdatedPassword123!");
    expect(resetRes).toBe(true);

    expect(sendChangedSpy).toHaveBeenCalledWith(customerEmail);

    sendChangedSpy.mockRestore();
    verifySpy.mockRestore();
  });
});
