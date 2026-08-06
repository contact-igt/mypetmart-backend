import { describe, expect, it } from "vitest";

import { databaseModels } from "../../src/database/index.js";

describe("sensitive model serialization", () => {
  it("excludes User.password_hash from ordinary JSON serialization", () => {
    const user = databaseModels.User.build({
      name: "Mira",
      email: "MIRA@EXAMPLE.COM",
      password_hash: "stored-password-hash",
      phone: null,
      email_verified_at: null,
      last_login_at: null
    });

    expect(user.email).toBe("mira@example.com");
    expect(user.password_hash).toBe("stored-password-hash");
    expect(user.toJSON()).not.toHaveProperty("password_hash");
  });

  it("excludes AuthSession.token_hash from ordinary JSON serialization", () => {
    const session = databaseModels.AuthSession.build({
      user_id: "11111111-1111-4111-8111-111111111111",
      session_type: "customer",
      token_hash: "stored-token-hash",
      user_agent: null,
      ip_address: null,
      expires_at: new Date(Date.now() + 1000),
      revoked_at: null
    });

    expect(session.token_hash).toBe("stored-token-hash");
    expect(session.toJSON()).not.toHaveProperty("token_hash");
  });

  it("excludes Cart.guest_token_hash from ordinary JSON serialization", () => {
    const cart = databaseModels.Cart.build({
      user_id: null,
      guest_token_hash: "stored-guest-token-hash",
      expires_at: null
    });

    expect(cart.guest_token_hash).toBe("stored-guest-token-hash");
    expect(cart.toJSON()).not.toHaveProperty("guest_token_hash");
  });
});