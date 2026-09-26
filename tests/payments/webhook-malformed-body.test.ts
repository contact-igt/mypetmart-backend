// Production outage regression: a POST to a provider webhook with no body (or
// a content type express.json/urlencoded don't parse) leaves req.body
// undefined under Express 5. The handlers dereferenced it outside any
// try/catch, the rejection went unhandled, and server.ts's unhandledRejection
// hook shut the whole API down. Public webhooks must ack malformed input.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { connectDatabase, disconnectDatabase } from "../../src/database/index.js";

const cases = [
  ["PayU payment webhook", "/api/v1/payments/payu/webhook"],
  ["PayU refund webhook", "/api/v1/payments/payu/refund-webhook"]
] as const;

describe("public payment webhooks survive malformed bodies", () => {
  beforeAll(async () => { await connectDatabase(); });
  afterAll(async () => { await disconnectDatabase(); });

  for (const [label, url] of cases) {
    it(`${label}: no body is acked, never an unhandled error`, async () => {
      const res = await request(app).post(url).timeout(4000);
      expect(res.status).toBe(200);
    });

    it(`${label}: unparsed content type is acked, never an unhandled error`, async () => {
      const res = await request(app).post(url).set("Content-Type", "text/plain").send("ping").timeout(4000);
      expect(res.status).toBe(200);
    });
  }

  it("Breeze webhook: no body never produces an unhandled error", async () => {
    const res = await request(app).post("/api/v1/payments/breeze/webhook").set("x-api-key", process.env.BREEZE_WEBHOOK_SECRET ?? "").timeout(4000);
    expect([200, 500]).toContain(res.status); // answered (caught), never hung by an unhandled rejection
  });
});
