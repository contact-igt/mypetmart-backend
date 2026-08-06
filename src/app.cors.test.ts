import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "./app.js";
import { corsConfig } from "./config/cors.config.js";

const storefrontOrigin = corsConfig.allowedOrigins[0] ?? "";
const adminOrigin = corsConfig.allowedOrigins[1] ?? "";

describe("CORS allowlist", () => {
  it("allows the configured storefront origin", async () => {
    const response = await request(app).get("/api/v1/health").set("Origin", storefrontOrigin).expect(200);

    expect(response.header["access-control-allow-origin"]).toBe(storefrontOrigin);
  });

  it("allows the configured admin origin", async () => {
    const response = await request(app).get("/api/v1/health").set("Origin", adminOrigin).expect(200);

    expect(response.header["access-control-allow-origin"]).toBe(adminOrigin);
  });

  it("rejects an unknown browser origin", async () => {
    const response = await request(app).get("/api/v1/health").set("Origin", "http://localhost:9999").expect(403);

    expect(response.body).toMatchObject({
      success: false,
      error: {
        code: "CORS_ORIGIN_NOT_ALLOWED",
        message: "The request origin is not allowed."
      }
    });
  });

  it("allows requests without an Origin header", async () => {
    const response = await request(app).get("/api/v1/health").expect(200);

    expect(response.header["access-control-allow-origin"]).toBeUndefined();
  });

  it("handles allowed preflight requests", async () => {
    const response = await request(app)
      .options("/api/v1/health")
      .set("Origin", storefrontOrigin)
      .set("Access-Control-Request-Method", "GET")
      .expect(204);

    expect(response.header["access-control-allow-origin"]).toBe(storefrontOrigin);
  });
});
