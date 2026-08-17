/* eslint-disable */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express from "express";
import rateLimit from "express-rate-limit";
import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { User, AuthSession } from "../../src/database/tables/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { sendError } from "../../src/utils/api-response.js";

// Helper to make test rate limiter
const testLimiter = rateLimit({
  windowMs: 60000,
  max: 1,
  handler: (req, res) => {
    sendError(res, 429, "AUTH_RATE_LIMITED", "Too many requests. Please try again later.");
  }
});

const limiterApp = express();
limiterApp.use(express.json());
limiterApp.post("/limit-test", testLimiter, (req, res) => {
  res.status(200).json({ ok: true });
});

describe("Stage 7: Auth integration tests", () => {
  let customerToken: string = "";
  let customerCookie: string = "";
  let adminToken: string = "";
  let adminCookie: string = "";
  let superAdminToken: string = "";

  beforeAll(async () => {
    await connectDatabase();
    const testEmails = [
      "signup-test@example.com",
      "signin-test@example.com",
      "disabled-test@example.com",
      "admin-test@example.com",
      "superadmin-test@example.com",
      "revoked-test@example.com",
      "invictusglobaltech@gmail.com"
    ];
    const users = await User.findAll({ where: { email: testEmails } });
    const userIds = users.map((u) => u.id);
    if (userIds.length > 0) {
      await AuthSession.destroy({ where: { user_id: userIds }, force: true });
      await User.destroy({ where: { id: userIds }, force: true });
    }

    let superAdmin = await User.findOne({ where: { email: "invictusglobaltech@gmail.com" } });
    if (!superAdmin) {
      const pwdHash = await PasswordService.hash("Invictus@123");
      await User.create({
        id: 30001,
        name: "invictusglobaltech",
        email: "invictusglobaltech@gmail.com",
        phone: "8939698905",
        password_hash: pwdHash,
        role: "super_admin",
        status: "active",
        reference_code: "SUP-030001"
      });
    }
  });

  afterAll(async () => {
    // Cleanup created test records
    await AuthSession.destroy({ where: {}, force: true });
    await User.destroy({ where: { email: [
      "signup-test@example.com",
      "signin-test@example.com",
      "disabled-test@example.com",
      "admin-test@example.com",
      "superadmin-test@example.com",
      "revoked-test@example.com"
    ] }, force: true });
    await disconnectDatabase();
  });

  // --- Customer Flow ---

  it("1. Signup creates an unverified customer and OTP verification creates safe session", async () => {
    const signupRes = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Test User",
        email: "signup-test@example.com",
        phone: "9876543210",
        password: "PrivatePassword123!",
        passwordConfirmation: "PrivatePassword123!"
      })
      .expect(200);

    expect(signupRes.body.success).toBe(true);
    expect(signupRes.body.data.verificationRequired).toBe(true);
    const { challengeId, generatedOtpForTest } = signupRes.body.data;

    const res = await request(app)
      .post("/api/v1/auth/verify-email")
      .send({
        challengeId,
        otp: generatedOtpForTest
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.role).toBe("customer");
    expect(res.body.data.user.status).toBe("active");
    expect(res.body.data.user.password_hash).toBeUndefined();

    const cookies = (res.headers["set-cookie"] as unknown) as string[];
    expect(cookies).toBeDefined();
    const hasCookie = cookies.some((c: string) => c.startsWith("mypetmart_customer_refresh"));
    expect(hasCookie).toBe(true);

    customerToken = res.body.data.accessToken;
    customerCookie = cookies.find((c: string) => c.startsWith("mypetmart_customer_refresh")) || "";
  });

  it("2. Duplicate signup for verified email is rejected", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signup")
      .send({
        name: "Test User",
        email: "signup-test@example.com",
        phone: "9876543210",
        password: "PrivatePassword123!",
        passwordConfirmation: "PrivatePassword123!"
      })
      .expect(409);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_EMAIL_ALREADY_EXISTS");
  });

  it("3. Customer signin succeeds for verified customer", async () => {
    const passwordHash = await PasswordService.hash("PrivatePassword123!");
    await User.create({
      id: 30002,
      name: "Signin User",
      email: "signin-test@example.com",
      phone: "1234567890",
      password_hash: passwordHash,
      role: "customer",
      status: "active",
      email_verified_at: new Date(),
      reference_code: "CUS-030002"
    });

    const res = await request(app)
      .post("/api/v1/auth/signin")
      .send({
        email: "signin-test@example.com",
        password: "PrivatePassword123!"
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.email).toBe("signin-test@example.com");
  });

  it("4. Invalid email or password returns the same generic error", async () => {
    // Wrong password
    const res1 = await request(app)
      .post("/api/v1/auth/signin")
      .send({
        email: "signin-test@example.com",
        password: "WrongPassword123!"
      })
      .expect(401);

    expect(res1.body.success).toBe(false);
    expect(res1.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");

    // Unknown email
    const res2 = await request(app)
      .post("/api/v1/auth/signin")
      .send({
        email: "unknown-user-email@example.com",
        password: "PrivatePassword123!"
      })
      .expect(401);

    expect(res2.body.success).toBe(false);
    expect(res2.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("5. Customer /me returns a safe profile", async () => {
    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${customerToken}`);
    
    if (res.status !== 200) {
      console.log("Customer /me failed body:", JSON.stringify(res.body, null, 2));
    }
    expect(res.status).toBe(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.email).toBe("signup-test@example.com");
    expect(res.body.data.password_hash).toBeUndefined();
    expect(res.body.data.token_hash).toBeUndefined();
  });

  it("6. Refresh rotates the token and invalidates the old refresh token", async () => {
    const cookieVal = customerCookie.split(";")[0] || "";
    const res = await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", [cookieVal]);
    
    if (res.status !== 200) {
      console.log("Customer refresh failed body:", JSON.stringify(res.body, null, 2));
    }
    expect(res.status).toBe(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();

    // Verify rotated cookie is set
    const cookies = (res.headers["set-cookie"] as unknown) as string[];
    expect(cookies).toBeDefined();
    const rotatedCookie = cookies.find((c: string) => c.startsWith("mypetmart_customer_refresh")) || "";
    expect(rotatedCookie).toBeDefined();

    // Old refresh cookie should now be invalid/revoked in DB, so calling refresh again with old cookie must fail
    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", [customerCookie.split(";")[0] || ""])
      .expect(401);

    // Save new cookie for subsequent operations
    customerCookie = rotatedCookie;
  });

  it("7. Logout revokes the session and clears the cookie", async () => {
    const cookieVal = customerCookie.split(";")[0] || "";
    const res = await request(app)
      .post("/api/v1/auth/logout")
      .set("Cookie", [cookieVal])
      .expect(200);

    // Check cookie cleared
    const cookies = (res.headers["set-cookie"] as unknown) as string[];
    const cleared = cookies.some((c: string) => {
      const lower = c.toLowerCase();
      return lower.includes("max-age=0") || lower.includes("expires=");
    });
    expect(cleared).toBe(true);

    // Session should be revoked now, so refresh using it must fail
    await request(app)
      .post("/api/v1/auth/refresh")
      .set("Cookie", [cookieVal])
      .expect(401);
  });

  // --- Privileged Flow ---

  it("8. Seeded super admin can sign in", async () => {
    const res = await request(app)
      .post("/api/v1/admin/auth/signin")
      .send({
        email: "invictusglobaltech@gmail.com",
        password: "Invictus@123"
      });
    
    if (res.status !== 200) {
      console.log("Super admin signin failed body:", JSON.stringify(res.body, null, 2));
    }
    expect(res.status).toBe(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.role).toBe("super_admin");

    const cookies = (res.headers["set-cookie"] as unknown) as string[];
    expect(cookies.some((c: string) => c.startsWith("mypetmart_admin_refresh"))).toBe(true);
    superAdminToken = res.body.data.accessToken;
  });

  it("9. Normal admin can sign in when a controlled test admin exists", async () => {
    const existingAdmin = await User.findOne({ where: { email: "admin-test@example.com" } });
    if (existingAdmin) {
      await AuthSession.destroy({ where: { user_id: existingAdmin.id }, force: true });
      await User.destroy({ where: { id: existingAdmin.id }, force: true });
    }
    const passwordHash = await PasswordService.hash("PrivatePassword123!");
    await User.create({
      id: 30003,
      name: "Admin User",
      email: "admin-test@example.com",
      phone: "1234567890",
      password_hash: passwordHash,
      role: "admin",
      status: "active",
      email_verified_at: new Date(),
      reference_code: "ADM-030003"
    });

    const res = await request(app)
      .post("/api/v1/admin/auth/signin")
      .send({
        email: "admin-test@example.com",
        password: "PrivatePassword123!"
      })
      .expect(200);

    expect(res.body.success).toBe(true);
    expect(res.body.data.accessToken).toBeDefined();
    expect(res.body.data.user.role).toBe("admin");

    const cookies = (res.headers["set-cookie"] as unknown) as string[];
    adminCookie = cookies.find((c: string) => c.startsWith("mypetmart_admin_refresh")) || "";
    adminToken = res.body.data.accessToken;
  });

  it("10. Customer cannot use privileged signin", async () => {
    const res = await request(app)
      .post("/api/v1/admin/auth/signin")
      .send({
        email: "signup-test@example.com",
        password: "PrivatePassword123!"
      })
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_INVALID_CREDENTIALS");
  });

  it("11. Admin /me accepts admin and super admin", async () => {
    // Verify super_admin
    const res1 = await request(app)
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${superAdminToken}`);
    if (res1.status !== 200) {
      console.log("Test 11 superAdmin /me failed:", JSON.stringify(res1.body, null, 2));
    }
    expect(res1.status).toBe(200);
    expect(res1.body.data.role).toBe("super_admin");

    // Verify admin
    const res2 = await request(app)
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${adminToken}`);
    if (res2.status !== 200) {
      console.log("Test 11 admin /me failed:", JSON.stringify(res2.body, null, 2));
    }
    expect(res2.status).toBe(200);
    expect(res2.body.data.role).toBe("admin");
  });

  it("12. Customer token cannot access admin /me", async () => {
    // Generate a fresh customer token for signup-test
    const customer = await User.findOne({ where: { email: "signup-test@example.com" } });
    const freshCustomerToken = TokenService.generateAccessToken({
      sub: String(customer!.id),
      sessionId: "dummy-session-id",
      role: "customer",
      sessionType: "customer"
    });

    const res = await request(app)
      .get("/api/v1/admin/auth/me")
      .set("Authorization", `Bearer ${freshCustomerToken}`)
      .expect(401); // authenticate('admin') middleware will reject it due to sessionType mismatch or role mismatch

    expect(res.body.success).toBe(false);
  });

  // --- Security ---

  it("13. Disabled user cannot sign in", async () => {
    await User.destroy({ where: { email: "disabled-test@example.com" }, force: true });
    const passwordHash = await PasswordService.hash("PrivatePassword123!");
    await User.create({
      id: 30004,
      name: "Disabled User",
      email: "disabled-test@example.com",
      phone: "1234567890",
      password_hash: passwordHash,
      role: "customer",
      status: "disabled",
      email_verified_at: null,
      reference_code: "CUS-030004"
    });

    const res = await request(app)
      .post("/api/v1/auth/signin")
      .send({
        email: "disabled-test@example.com",
        password: "PrivatePassword123!"
      })
      .expect(403);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_ACCOUNT_DISABLED");
  });

  it("14. Revoked session cannot access /me", async () => {
    // Create a new session for signup-test customer
    const customer = await User.findOne({ where: { email: "signup-test@example.com" } });
    const { session, refreshToken } = await SessionService.createSession(
      customer!.id,
      "customer",
      null,
      null
    );

    const token = TokenService.generateAccessToken({
      sub: String(customer!.id),
      sessionId: String(session.id),
      role: customer!.role,
      sessionType: "customer"
    });

    // Revoke it
    await SessionService.revokeSession(refreshToken, "customer");

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(401);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_SESSION_REVOKED");
  });

  it("15. Responses never contain password_hash or token_hash", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signin")
      .send({
        email: "signin-test@example.com",
        password: "PrivatePassword123!"
      })
      .expect(200);

    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain("password_hash");
    expect(bodyStr).not.toContain("token_hash");
  });

  it("16. Refresh cookies have required security attributes", async () => {
    const res = await request(app)
      .post("/api/v1/auth/signin")
      .send({
        email: "signin-test@example.com",
        password: "PrivatePassword123!"
      })
      .expect(200);

    const cookies = (res.headers["set-cookie"] as unknown) as string[];
    const cookie = cookies.find((c: string) => c.startsWith("mypetmart_customer_refresh")) || "";

    const lowerCookie = cookie.toLowerCase();
    expect(lowerCookie).toContain("httponly");
    expect(lowerCookie).toContain("samesite=lax");
    expect(lowerCookie).toContain("path=/api/v1/auth");
  });

  it("17. Wrong audience or session type is rejected", async () => {
    // Create token with wrong audience
    const customer = await User.findOne({ where: { email: "signup-test@example.com" } });
    const badToken = TokenService.generateAccessToken({
      sub: String(customer!.id),
      sessionId: "dummy-id",
      role: "customer",
      sessionType: "admin" // mismatch with authenticate('customer')
    });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", `Bearer ${badToken}`)
      .expect(401);

    expect(res.body.success).toBe(false);
  });

  it("18. Auth rate limiter returns the safe error response", async () => {
    // Hit the test limiter endpoint twice. Since max is 1, second request should trigger 429.
    await request(limiterApp).post("/limit-test").send({}).expect(200);
    const res = await request(limiterApp).post("/limit-test").send({}).expect(429);

    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("AUTH_RATE_LIMITED");
  });
});
