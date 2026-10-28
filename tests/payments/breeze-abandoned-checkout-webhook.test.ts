import request from "supertest";
import { describe, expect, it } from "vitest";

import { app } from "../../src/app.js";

const URL = "/api/v1/payments/breeze/abandoned-checkout-webhook";
const API_KEY = "test_breeze_abandoned_checkout_api_key_do_not_use_in_prod";

describe("Breeze abandoned-checkout webhook", () => {
  it("authenticates and acknowledges a JSON event without releasing a checkout", async () => {
    const response = await request(app).post(URL).set("X-Api-Key", API_KEY).send({ cartDetails: {}, customer: {}, checkoutUrl: "https://example.test/cart" });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "RECEIVED" });
  });

  it("rejects a missing or invalid API key", async () => {
    const validBody = { cartDetails: {}, customer: {}, checkoutUrl: "https://example.test/cart" };
    expect((await request(app).post(URL).send(validBody)).status).toBe(401);
    expect((await request(app).post(URL).set("X-Api-Key", "wrong").send(validBody)).status).toBe(401);
  });

  it("rejects a malformed authenticated payload", async () => {
    expect((await request(app).post(URL).set("X-Api-Key", API_KEY).send({})).status).toBe(422);
  });
});
