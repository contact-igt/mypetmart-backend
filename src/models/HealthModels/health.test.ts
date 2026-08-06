import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../../app.js";

type HealthResponseBody = {
  success: true;
  data: {
    status: "ok";
    service: string;
    version: string;
    timestamp: string;
  };
  meta: {
    requestId: string;
  };
};

describe("GET /api/v1/health", () => {
  it("returns the health response with request metadata", async () => {
    const response = await request(app).get("/api/v1/health").expect(200).expect("Content-Type", /json/);
    const body = response.body as HealthResponseBody;
    const requestId = response.header["x-request-id"];

    expect(requestId).toEqual(expect.any(String));
    expect(body).toMatchObject({
      success: true,
      data: {
        status: "ok",
        service: "mypetmart-backend",
        version: "0.1.0"
      },
      meta: {
        requestId
      }
    });
    expect(Date.parse(body.data.timestamp)).not.toBeNaN();
  });

  it("uses a safe client-provided request ID", async () => {
    const clientRequestId = "client-request-123";
    const response = await request(app).get("/api/v1/health").set("X-Request-Id", clientRequestId).expect(200);
    const body = response.body as HealthResponseBody;

    expect(response.header["x-request-id"]).toBe(clientRequestId);
    expect(body.meta.requestId).toBe(clientRequestId);
  });

  it("replaces malformed client-provided request IDs", async () => {
    const response = await request(app).get("/api/v1/health").set("X-Request-Id", "unsafe request id").expect(200);
    const body = response.body as HealthResponseBody;

    expect(response.header["x-request-id"]).toEqual(expect.any(String));
    expect(response.header["x-request-id"]).not.toBe("unsafe request id");
    expect(body.meta.requestId).toBe(response.header["x-request-id"]);
  });
});
