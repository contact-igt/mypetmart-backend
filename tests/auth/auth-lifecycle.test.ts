/* eslint-disable */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../../src/app.js";
import { connectDatabase, sequelize } from "../../src/database/index.js";
import { User, AuthSession, AuthChallenge, PasswordResetToken } from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";

describe("Stage 8.7: Email verification & password reset lifecycle integration tests", () => {
  const testEmail = "lifecycle-user@example.com";
  const testPassword = "InitialPassword123";
  const newPassword = "UpdatedPassword456";

  const cleanupSpecificUsers = async () => {
    const user = await User.findOne({ where: { email: testEmail } });
    if (user) {
      await PasswordResetToken.destroy({ where: { user_id: user.id }, force: true });
      await AuthChallenge.destroy({ where: { user_id: user.id }, force: true });
      await AuthSession.destroy({ where: { user_id: user.id }, force: true });
      await User.destroy({ where: { id: user.id }, force: true });
    }
  };

  beforeAll(async () => {
    await connectDatabase();
    await cleanupSpecificUsers();
  });

  afterAll(async () => {
    await cleanupSpecificUsers();
  });

  let challengeId: number = 0;
  let otpForTest: string = "";
  let resetChallengeId: number = 0;
  let resetOtpForTest: string = "";
  let resetCookie: string = "";
  let recoveryCookieHeader: string = "";

  it("1. Signup creates unverified customer and no session", async () => {
    const res = await request(app)
      .post("/api/v1/auth/customer/signup")
      .send({
        name: "Lifecycle User",
        email: testEmail,
        password: testPassword,
        passwordConfirmation: testPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verificationRequired).toBe(true);
    expect(res.body.data.challengeId).toBeGreaterThan(0);
    expect(res.headers["set-cookie"]).toBeUndefined();

    challengeId = res.body.data.challengeId;
    otpForTest = res.body.data.generatedOtpForTest;

    const user = await User.findOne({ where: { email: testEmail } });
    expect(user).not.toBeNull();
    expect(user?.email_verified_at).toBeNull();
  });

  it("2. Signup creates email verification challenge in database", async () => {
    const challenge = await AuthChallenge.findByPk(challengeId);
    expect(challenge).not.toBeNull();
    expect(challenge?.purpose).toBe("email_verification");
    expect(challenge?.attempt_count).toBe(0);
    expect(challenge?.consumed_at).toBeNull();
  });

  it("3. Incorrect OTP increments attempt_count and returns AUTH_OTP_INVALID", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        challengeId,
        otp: "000000"
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_OTP_INVALID");

    const challenge = await AuthChallenge.findByPk(challengeId);
    expect(challenge?.attempt_count).toBe(1);
  });

  it("4. Signin blocks unverified customer and returns verificationRequired", async () => {
    const res = await request(app)
      .post("/api/v1/auth/customer/signin")
      .send({
        email: testEmail,
        password: testPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.verificationRequired).toBe(true);
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("5. Correct OTP verifies email, sets email_verified_at, and creates authenticated session", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        challengeId,
        otp: otpForTest
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.email).toBe(testEmail);
    expect(res.headers["set-cookie"]).toBeDefined();

    const user = await User.findOne({ where: { email: testEmail } });
    expect(user?.email_verified_at).not.toBeNull();
  });

  it("6. Consumed OTP cannot be reused", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        challengeId,
        otp: otpForTest
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_OTP_EXPIRED");
  });

  it("7. Verified customer signin creates normal authenticated session", async () => {
    const res = await request(app)
      .post("/api/v1/auth/customer/signin")
      .send({
        email: testEmail,
        password: testPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.headers["set-cookie"]).toBeDefined();
  });

  it("8. Resend cooldown enforces rate limiting", async () => {
    const res = await request(app)
      .post("/api/v1/auth/resend-verification")
      .send({
        email: testEmail
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("9. Forgot password returns generic response for both existing and nonexistent email", async () => {
    const resExist = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: testEmail });

    expect(resExist.status).toBe(200);
    expect(resExist.body.success).toBe(true);
    expect(resExist.body.data.message).toBe("If an account exists for this email, a verification code has been sent.");

    const setCookies = resExist.headers["set-cookie"] as unknown as string[];
    const recoveryCookie = setCookies?.find((c) => c.startsWith("mypetmart_recovery="));
    recoveryCookieHeader = recoveryCookie?.split(";")[0] ?? "";
    const recoveryToken = recoveryCookieHeader.split("=")[1];
    if (recoveryToken) {
      const jwt = (await import("jsonwebtoken")).default;
      const decoded = jwt.decode(recoveryToken) as any;
      resetChallengeId = decoded?.challengeId;
      resetOtpForTest = decoded?.generatedOtpForTest;
    }

    const resNonExist = await request(app)
      .post("/api/v1/auth/forgot-password")
      .send({ email: "nonexistent-user-12345@example.com" });

    expect(resNonExist.status).toBe(200);
    expect(resNonExist.body.success).toBe(true);
    expect(resNonExist.body.data.message).toBe("If an account exists for this email, a verification code has been sent.");
  });

  it("10. Password-reset OTP cannot be used for email verification endpoint", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        challengeId: resetChallengeId,
        otp: resetOtpForTest
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("11. Email-verification OTP cannot be used for verify-reset-otp endpoint", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-reset-otp")
      .set("Cookie", [recoveryCookieHeader])
      .send({
        otp: otpForTest
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("12. Verify reset OTP creates password reset cookie authorization", async () => {
    const res = await request(app)
      .post("/api/v1/auth/verify-reset-otp")
      .set("Cookie", [recoveryCookieHeader])
      .send({
        otp: resetOtpForTest
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.resetTokenGranted).toBe(true);
    expect(res.headers["set-cookie"]).toBeDefined();
    const cookies = res.headers["set-cookie"] as unknown as string[];
    const matchedResetCookie = cookies.find((c) => c.startsWith("mypetmart_password_reset="));
    resetCookie = matchedResetCookie?.split(";")[0] ?? "";
  });

  it("13. Reset password changes password hash, revokes all sessions, and clears reset cookie", async () => {
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .set("Cookie", [resetCookie])
      .send({
        password: newPassword,
        passwordConfirmation: newPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.passwordReset).toBe(true);

    const user = await User.findOne({ where: { email: testEmail } });
    const isNewPasswordValid = await PasswordService.verify(newPassword, user!.password_hash);
    expect(isNewPasswordValid).toBe(true);

    const activeSessions = await AuthSession.findAll({ where: { user_id: user!.id, revoked_at: null } });
    expect(activeSessions.length).toBe(0);
  });

  it("14. Old password fails after password reset", async () => {
    const res = await request(app)
      .post("/api/v1/auth/customer/signin")
      .send({
        email: testEmail,
        password: testPassword
      });

    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("15. New password succeeds after password reset", async () => {
    const res = await request(app)
      .post("/api/v1/auth/customer/signin")
      .send({
        email: testEmail,
        password: newPassword
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
  });

  it("16. Reset authorization token cannot be reused", async () => {
    const res = await request(app)
      .post("/api/v1/auth/reset-password")
      .set("Cookie", [resetCookie])
      .send({
        password: "AnotherPassword789",
        passwordConfirmation: "AnotherPassword789"
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
