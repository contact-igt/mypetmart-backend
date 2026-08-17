/* eslint-disable */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { connectDatabase } from "../../src/database/index.js";
import { User, AuthChallenge, AuthSession, PasswordResetToken } from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { emailService } from "../../src/services/email/email.service.js";
import { computeOTPHash } from "../../src/services/auth-challenge/auth-challenge.service.js";

describe("Stage 8.8: Existing unverified signup OTP regression", () => {
  const unverifiedEmail = "unverified-retry@example.com";
  const verifiedEmail = "verified-retry@example.com";
  const adminEmail = "admin-retry@example.com";
  const testPassword = "SecurePassword123!";

  // Only cleans up the unverified user (which changes state between tests)
  const cleanupUnverifiedUser = async () => {
    const users = await User.findAll({ where: { email: [unverifiedEmail] } });
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      await PasswordResetToken.destroy({ where: { user_id: userIds }, force: true });
      await AuthChallenge.destroy({ where: { user_id: userIds }, force: true });
      await AuthSession.destroy({ where: { user_id: userIds }, force: true });
      await User.destroy({ where: { id: userIds }, force: true });
    }
  };

  // Cleans up ALL test users (used in afterAll only)
  const cleanupAllTestData = async () => {
    const users = await User.findAll({ where: { email: [unverifiedEmail, verifiedEmail, adminEmail] } });
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
    await cleanupAllTestData();

    const passwordHash = await PasswordService.hash(testPassword);

    // Seed a verified customer (should reject re-signup)
    await User.create({
      id: 40001,
      name: "Verified Retry",
      email: verifiedEmail,
      phone: "1111111111",
      password_hash: passwordHash,
      role: "customer",
      status: "active",
      email_verified_at: new Date(),
      reference_code: "CUS-040001"
    });

    // Seed an admin (should reject public customer signup)
    await User.create({
      id: 40002,
      name: "Admin Retry",
      email: adminEmail,
      phone: "2222222222",
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      email_verified_at: new Date(),
      reference_code: "ADM-040002"
    });
  });

  afterAll(async () => {
    await cleanupAllTestData();
  });

  /**
   * Regression Test 1: Fresh signup creates user once, sends OTP email, returns verificationRequired
   */
  it("RT1: Fresh signup sends verification email and creates unverified user", async () => {
    const sendVerifySpy = vi.spyOn(emailService, "sendVerificationOTP");

    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Unverified Retry",
        email: unverifiedEmail,
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verificationRequired).toBe(true);
    expect(res.body.data.challengeId).toBeGreaterThan(0);
    expect(res.body.data.maskedEmail).toBeDefined();
    expect(res.body.data.resendAvailableAt).toBeDefined();

    // No session cookie – unverified
    const cookies = res.headers["set-cookie"] as string[] | undefined;
    const hasSessionCookie = cookies?.some((c: string) => c.startsWith("mypetmart_customer_refresh"));
    expect(hasSessionCookie).toBeFalsy();

    // Email service must have been called exactly once
    expect(sendVerifySpy).toHaveBeenCalledTimes(1);
    const [recipientArg, otpArg, ttlArg] = sendVerifySpy.mock.calls[0]!;
    expect(recipientArg).toBe(unverifiedEmail);
    expect(otpArg).toHaveLength(6);
    expect(typeof ttlArg).toBe("number");

    // DB: exactly 1 user with this email
    const userCount = await User.count({ where: { email: unverifiedEmail } });
    expect(userCount).toBe(1);

    // DB: user is unverified
    const user = await User.findOne({ where: { email: unverifiedEmail } });
    expect(user).not.toBeNull();
    expect(user!.email_verified_at).toBeNull();

    // DB: exactly 1 email_verification challenge
    const challengeCount = await AuthChallenge.count({
      where: { user_id: user!.id, purpose: "email_verification" }
    });
    expect(challengeCount).toBe(1);

    sendVerifySpy.mockRestore();
  });

  /**
   * Regression Test 2: Signup again WITHIN cooldown returns verificationRequired
   * without new OTP or email, without duplicating the user
   */
  it("RT2: Signup again within cooldown returns verificationRequired without new OTP or email", async () => {
    const sendVerifySpy = vi.spyOn(emailService, "sendVerificationOTP");

    // Capture state before retry
    const userBefore = await User.findOne({ where: { email: unverifiedEmail } });
    expect(userBefore).not.toBeNull();
    const userIdBefore = userBefore!.id;
    const refCodeBefore = userBefore!.reference_code;

    const challengeBefore = await AuthChallenge.findOne({
      where: { user_id: userIdBefore, purpose: "email_verification", consumed_at: null }
    });
    expect(challengeBefore).not.toBeNull();
    const oldCodeHash = challengeBefore!.code_hash;
    const oldChallengeId = challengeBefore!.id;

    // Retry signup WITHIN cooldown (well within 60s of RT1)
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Unverified Retry",
        email: unverifiedEmail,
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verificationRequired).toBe(true);
    // Must return the existing challengeId
    expect(res.body.data.challengeId).toBe(oldChallengeId);
    expect(res.body.data.maskedEmail).toBeDefined();
    expect(res.body.data.resendAvailableAt).toBeDefined();

    // No NEW email sent (still in cooldown)
    expect(sendVerifySpy).not.toHaveBeenCalled();

    // Exactly 1 user – no duplicate
    const userCount = await User.count({ where: { email: unverifiedEmail } });
    expect(userCount).toBe(1);

    // User ID and reference code unchanged
    const userAfter = await User.findOne({ where: { email: unverifiedEmail } });
    expect(userAfter!.id).toBe(userIdBefore);
    expect(userAfter!.reference_code).toBe(refCodeBefore);

    // OTP hash unchanged (no new OTP generated)
    const challengeAfter = await AuthChallenge.findOne({
      where: { user_id: userIdBefore, purpose: "email_verification", consumed_at: null }
    });
    expect(challengeAfter).not.toBeNull();
    expect(challengeAfter!.code_hash).toBe(oldCodeHash);

    sendVerifySpy.mockRestore();
  });

  /**
   * Regression Test 3: Signup again after cooldown expires generates new OTP and sends new email
   * We simulate cooldown expiry by backdating resend_available_at in the DB
   */
  it("RT3: Signup again after cooldown expires generates new OTP and sends new email", async () => {
    const sendVerifySpy = vi.spyOn(emailService, "sendVerificationOTP");

    const user = await User.findOne({ where: { email: unverifiedEmail } });
    const challenge = await AuthChallenge.findOne({
      where: { user_id: user!.id, purpose: "email_verification", consumed_at: null }
    });
    expect(challenge).not.toBeNull();

    const oldCodeHash = challenge!.code_hash;
    const oldChallengeId = challenge!.id;

    // Backdate resend_available_at to simulate cooldown expiry; keep expires_at in future
    await challenge!.update({
      resend_available_at: new Date(Date.now() - 120_000),
      expires_at: new Date(Date.now() + 600_000)
    });

    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Unverified Retry",
        email: unverifiedEmail,
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verificationRequired).toBe(true);

    // New email MUST have been dispatched
    expect(sendVerifySpy).toHaveBeenCalledTimes(1);
    const [recipientArg, otpArg] = sendVerifySpy.mock.calls[0]!;
    expect(recipientArg).toBe(unverifiedEmail);
    expect(otpArg).toHaveLength(6);

    // Same challenge row (updated in place, not duplicated)
    const challengeAfter = await AuthChallenge.findOne({
      where: { user_id: user!.id, purpose: "email_verification", consumed_at: null }
    });
    expect(challengeAfter).not.toBeNull();
    expect(challengeAfter!.id).toBe(oldChallengeId); // same row

    // OTP hash MUST have changed
    expect(challengeAfter!.code_hash).not.toBe(oldCodeHash);

    // Exactly 1 user still
    const userCount = await User.count({ where: { email: unverifiedEmail } });
    expect(userCount).toBe(1);

    sendVerifySpy.mockRestore();
  });

  /**
   * Regression Test 4: Deliberately wrong OTP fails with AUTH_OTP_INVALID
   */
  it("RT4: Deliberately wrong OTP fails with AUTH_OTP_INVALID", async () => {
    const user = await User.findOne({ where: { email: unverifiedEmail } });
    const challenge = await AuthChallenge.findOne({
      where: { user_id: user!.id, purpose: "email_verification", consumed_at: null }
    });
    expect(challenge).not.toBeNull();

    const res = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        challengeId: challenge!.id,
        otp: "000000" // deliberately invalid
      });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("AUTH_OTP_INVALID");

    const challengeAfter = await AuthChallenge.findByPk(challenge!.id);
    expect(challengeAfter!.attempt_count).toBeGreaterThan(0);
  });

  /**
   * Regression Test 5: New OTP from RT3 successfully verifies email and creates session
   */
  it("RT5: New OTP from RT3 verifies email, sets email_verified_at, creates session", async () => {
    const user = await User.findOne({ where: { email: unverifiedEmail } });
    const originalId = user!.id;
    const originalRefCode = user!.reference_code;

    const challenge = await AuthChallenge.findOne({
      where: { user_id: user!.id, purpose: "email_verification", consumed_at: null }
    });

    // Backdate again so we can get a fresh OTP via signup-again
    await challenge!.update({
      resend_available_at: new Date(Date.now() - 120_000),
      expires_at: new Date(Date.now() + 600_000),
      attempt_count: 0
    });

    const signupRes = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Unverified Retry",
        email: unverifiedEmail,
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(signupRes.status).toBe(200);
    expect(signupRes.body.data.verificationRequired).toBe(true);
    const { challengeId, generatedOtpForTest } = signupRes.body.data;
    expect(typeof generatedOtpForTest).toBe("string");
    expect(generatedOtpForTest).toHaveLength(6);

    // Verify with new OTP
    const verifyRes = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({ challengeId, otp: generatedOtpForTest });

    expect(verifyRes.status).toBe(200);
    expect(verifyRes.body.success).toBe(true);
    expect(verifyRes.body.data.accessToken).toBeDefined();

    // email_verified_at must now be populated
    const userAfter = await User.findOne({ where: { email: unverifiedEmail } });
    expect(userAfter!.email_verified_at).not.toBeNull();

    // ID and reference code must be unchanged throughout the entire flow
    expect(userAfter!.id).toBe(originalId);
    expect(userAfter!.reference_code).toBe(originalRefCode);
  });

  /**
   * Regression Test 6: sendVerificationOTP failure during retry outside cooldown is handled
   */
  it("RT6: sendVerificationOTP failure during retry outside cooldown is handled safely", async () => {
    // RT5 verified the user. Create a fresh unverified user for this test.
    await cleanupUnverifiedUser(); // Only cleans up unverifiedEmail, not verifiedEmail/adminEmail

    const passwordHash = await PasswordService.hash(testPassword);
    await User.create({
      id: 40003,
      name: "Email Fail Test",
      email: unverifiedEmail,
      phone: "3333333333",
      password_hash: passwordHash,
      role: "customer",
      status: "active",
      email_verified_at: null,
      reference_code: "CUS-040003"
    });

    const user = await User.findOne({ where: { email: unverifiedEmail } });
    await AuthChallenge.create({
      id: 40001,
      user_id: user!.id,
      purpose: "email_verification",
      code_hash: computeOTPHash("999999"),
      expires_at: new Date(Date.now() + 600_000),
      resend_available_at: new Date(Date.now() - 120_000), // cooldown already expired
      attempt_count: 0,
      max_attempts: 5,
      consumed_at: null
    });

    // Mock sendVerificationOTP to return false (SMTP failure simulation)
    const sendVerifySpy = vi.spyOn(emailService, "sendVerificationOTP").mockResolvedValueOnce(false);

    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Email Fail Test",
        email: unverifiedEmail,
        password: testPassword,
        passwordConfirmation: testPassword
      });

    // sendVerificationOTP MUST have been called (not silently skipped)
    expect(sendVerifySpy).toHaveBeenCalledTimes(1);

    // In test env NODE_ENV === "test" so EMAIL_DELIVERY_FAILED is not thrown;
    // the response must still be verificationRequired so the UI handles the state correctly.
    expect(res.status).toBe(200);
    expect(res.body.data.verificationRequired).toBe(true);

    sendVerifySpy.mockRestore();
  });

  /**
   * Regression Test 7: Verified existing user → EMAIL_ALREADY_EXISTS, no OTP
   */
  it("RT7: Verified existing user signup returns EMAIL_ALREADY_EXISTS without OTP", async () => {
    const sendVerifySpy = vi.spyOn(emailService, "sendVerificationOTP");

    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Verified Retry",
        email: verifiedEmail,
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_EMAIL_ALREADY_EXISTS");

    expect(sendVerifySpy).not.toHaveBeenCalled();

    sendVerifySpy.mockRestore();
  });

  /**
   * Regression Test 8: Admin email through public signup returns EMAIL_ALREADY_EXISTS
   * Role must not change, no OTP sent
   */
  it("RT8: Admin email in public signup returns EMAIL_ALREADY_EXISTS without OTP or role change", async () => {
    const sendVerifySpy = vi.spyOn(emailService, "sendVerificationOTP");

    const adminBefore = await User.findOne({ where: { email: adminEmail } });
    expect(adminBefore).not.toBeNull();
    expect(adminBefore!.role).toBe("admin");

    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Admin Retry",
        email: adminEmail,
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("AUTH_EMAIL_ALREADY_EXISTS");

    expect(sendVerifySpy).not.toHaveBeenCalled();

    const adminAfter = await User.findOne({ where: { email: adminEmail } });
    expect(adminAfter!.role).toBe("admin");
    expect(adminAfter!.id).toBe(adminBefore!.id);

    sendVerifySpy.mockRestore();
  });

  /**
   * Regression Test 9: Mixed-case/whitespace input email uses normalized stored email as OTP recipient
   */
  it("RT9: Mixed-case input email uses normalized stored email as the OTP recipient", async () => {
    await cleanupUnverifiedUser(); // Start fresh for this test

    const sendVerifySpy = vi.spyOn(emailService, "sendVerificationOTP");

    const signupRes = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Case Test",
        email: "  UNVERIFIED-retry@EXAMPLE.com  ", // mixed case + spaces
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(signupRes.status).toBe(200);
    expect(signupRes.body.data.verificationRequired).toBe(true);

    // Email passed to sendVerificationOTP must be normalized
    expect(sendVerifySpy).toHaveBeenCalledTimes(1);
    const [recipientArg] = sendVerifySpy.mock.calls[0]!;
    expect(recipientArg).toBe(unverifiedEmail); // "unverified-retry@example.com"

    // DB user email must be normalized
    const user = await User.findOne({ where: { email: unverifiedEmail } });
    expect(user).not.toBeNull();
    expect(user!.email).toBe(unverifiedEmail);

    sendVerifySpy.mockRestore();
  });

  /**
   * Regression Test 10: Signup-again does not create password_reset challenge or call sendPasswordResetOTP
   */
  it("RT10: Signup-again does not create password_reset challenge or call sendPasswordResetOTP", async () => {
    const sendResetSpy = vi.spyOn(emailService, "sendPasswordResetOTP");

    const user = await User.findOne({ where: { email: unverifiedEmail } });

    // Backdate cooldown so signup-again triggers a new OTP
    const challenge = await AuthChallenge.findOne({
      where: { user_id: user!.id, purpose: "email_verification", consumed_at: null }
    });
    if (challenge) {
      await challenge.update({ resend_available_at: new Date(Date.now() - 120_000) });
    }

    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Case Test",
        email: unverifiedEmail,
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.data.verificationRequired).toBe(true);

    // Password reset OTP must NOT have been called
    expect(sendResetSpy).not.toHaveBeenCalled();

    // No password_reset challenge must exist for this user
    const resetChallengeCount = await AuthChallenge.count({
      where: { user_id: user!.id, purpose: "password_reset" }
    });
    expect(resetChallengeCount).toBe(0);

    sendResetSpy.mockRestore();
  });
});
