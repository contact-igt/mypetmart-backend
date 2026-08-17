import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";

import { app } from "../../app.js";
import { r2Config } from "../../config/r2.config.js";
import { sequelize } from "../../database/index.js";

type SuccessReadinessBody = {
  success: true;
  data: {
    status: "ready";
    service: string;
    database: {
      status: "connected";
      name: string;
    };
    objectStorage: {
      provider: "cloudflare_r2";
      status: "configured" | "not_configured";
    };
    timestamp: string;
  };
  meta: {
    requestId: string;
  };
};

type ErrorReadinessBody = {
  success: false;
  error: {
    code: string;
    message: string;
  };
  meta: {
    requestId: string;
  };
};

describe("GET /api/v1/health/ready", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ready when the database check succeeds", async () => {
    vi.spyOn(sequelize, "authenticate").mockResolvedValue(undefined);

    const response = await request(app).get("/api/v1/health/ready").expect(200).expect("Content-Type", /json/);
    const body = response.body as SuccessReadinessBody;

    expect(response.header["x-request-id"]).toEqual(expect.any(String));
    expect(body).toMatchObject({
      success: true,
      data: {
        status: "ready",
        service: "mypetmart-backend",
        database: {
          status: "connected",
          name: sequelize.config.database || "mypetmart"
        },
        objectStorage: {
          provider: "cloudflare_r2",
          status: r2Config.ready ? "configured" : "not_configured"
        }
      },
      meta: {
        requestId: response.header["x-request-id"]
      }
    });
    expect(Date.parse(body.data.timestamp)).not.toBeNaN();
    expect(JSON.stringify(body)).not.toContain("DB_PASSWORD");
    expect(JSON.stringify(body)).not.toContain("root");
  });

  it("returns a safe 503 response when the database check fails", async () => {
    vi.spyOn(sequelize, "authenticate").mockRejectedValue(new Error("password should not leak"));

    const response = await request(app).get("/api/v1/health/ready").expect(503).expect("Content-Type", /json/);
    const body = response.body as ErrorReadinessBody;

    expect(body).toMatchObject({
      success: false,
      error: {
        code: "SERVICE_NOT_READY",
        message: "The service is not ready."
      },
      meta: {
        requestId: response.header["x-request-id"]
      }
    });
    expect(JSON.stringify(body)).not.toContain("password should not leak");
    expect(JSON.stringify(body)).not.toContain("stack");
  });
});
