import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../src/app.js";
import { errorHandlerMiddleware } from "../src/middlewares/error/error-handler.middleware.js";
import { requestIdMiddleware } from "../src/middlewares/request/request-id.middleware.js";

type ErrorResponseBody = {
  success: false;
  error: {
    code: string;
    message: string;
  };
  meta: {
    requestId: string;
  };
};

describe("application middleware", () => {
  it("returns a standard 404 response for unknown routes", async () => {
    const response = await request(app).get("/api/v1/unknown-route").expect(404).expect("Content-Type", /json/);
    const body = response.body as ErrorResponseBody;
    const requestId = response.header["x-request-id"];

    expect(body).toMatchObject({
      success: false,
      error: {
        code: "NOT_FOUND",
        message: "The requested resource was not found."
      },
      meta: {
        requestId
      }
    });
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("returns a safe 500 response for unexpected errors", async () => {
    const testApp = express();
    testApp.use(requestIdMiddleware);
    testApp.get("/test-error", () => {
      throw new Error("private implementation failure");
    });
    testApp.use(errorHandlerMiddleware);

    const response = await request(testApp).get("/test-error").expect(500).expect("Content-Type", /json/);
    const body = response.body as ErrorResponseBody;

    expect(body).toMatchObject({
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred."
      },
      meta: {
        requestId: response.header["x-request-id"]
      }
    });
    expect(JSON.stringify(body)).not.toContain("private implementation failure");
    expect(JSON.stringify(body)).not.toContain("stack");
  });

  it("returns a safe malformed JSON response", async () => {
    const response = await request(app)
      .post("/api/v1/health")
      .set("Content-Type", "application/json")
      .send("{ malformed")
      .expect(400)
      .expect("Content-Type", /json/);
    const body = response.body as ErrorResponseBody;

    expect(body).toMatchObject({
      success: false,
      error: {
        code: "MALFORMED_JSON",
        message: "The request body contains malformed JSON."
      },
      meta: {
        requestId: response.header["x-request-id"]
      }
    });
    expect(JSON.stringify(body)).not.toContain("SyntaxError");
  });

  it("returns a safe oversized JSON response", async () => {
    const oversizedBody = {
      payload: "x".repeat(1024 * 1024 + 1)
    };

    const response = await request(app)
      .post("/api/v1/health")
      .set("Content-Type", "application/json")
      .send(oversizedBody)
      .expect(413)
      .expect("Content-Type", /json/);
    const body = response.body as ErrorResponseBody;

    expect(body).toMatchObject({
      success: false,
      error: {
        code: "PAYLOAD_TOO_LARGE",
        message: "The request body is too large."
      },
      meta: {
        requestId: response.header["x-request-id"]
      }
    });
  });
});
