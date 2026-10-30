/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fromBreezePaymentAmount, fromProviderAmount, toProviderAmount } from "../../src/models/PaymentModels/breeze-money.js";
import { classifyBreezeStatus } from "../../src/models/PaymentModels/breeze-order-create.schema.js";

describe("Breeze money adapter (integer paise internally, explicit provider unit)", () => {
  it("parses an Order Create payment amount in rupees when the signed cart uses paise", () => {
    expect(fromBreezePaymentAmount(1)).toBe(100);
  });

  it("converts to the provider unit", () => {
    expect(toProviderAmount(50000, "paise")).toBe(50000);
    expect(toProviderAmount(50000, "rupees")).toBe(500);
    expect(toProviderAmount(12345, "rupees")).toBe(123.45);
    expect(() => toProviderAmount(1.5, "paise")).toThrow();
  });

  it("parses rupees exactly, with no float drift", () => {
    expect(fromProviderAmount(500, "rupees")).toBe(50000);
    expect(fromProviderAmount(123.45, "rupees")).toBe(12345);
    expect(fromProviderAmount(0.1 + 0.2, "rupees")).toBeNull(); // 0.30000000000000004: not an exact 2dp value
    expect(fromProviderAmount("10.5", "rupees")).toBe(1050);
    expect(fromProviderAmount("10.505", "rupees")).toBeNull();
  });

  it("paise unit accepts integers only", () => {
    expect(fromProviderAmount(50000, "paise")).toBe(50000);
    expect(fromProviderAmount(500.5, "paise")).toBeNull();
    expect(fromProviderAmount(-1, "paise")).toBeNull();
    expect(fromProviderAmount(Number.NaN, "paise")).toBeNull();
    expect(fromProviderAmount(null, "paise")).toBeNull();
    expect(fromProviderAmount({}, "rupees")).toBeNull();
  });

  it("a wrong unit assumption is detectable (500 rupees vs 500 paise are different amounts)", () => {
    expect(fromProviderAmount(500, "rupees")).not.toBe(fromProviderAmount(500, "paise"));
  });
});

describe("Breeze order status classification", () => {
  const cls = (status: string | undefined, event = "ORDER_SUCCEEDED") => classifyBreezeStatus(event, status);
  it("maps the documented vocabulary", () => {
    expect(cls("SUCCESS")).toBe("paid");
    expect(cls("PAYMENT_SUCCESS")).toBe("paid");
    expect(cls("CREATED")).toBe("unpaid_pending");
    expect(cls("PENDING")).toBe("unpaid_pending");
    expect(cls("PARTIALLY_PAID")).toBe("partial");
    for (const failed of ["FAILED", "CANCELLED", "AUTO_CANCELLED"]) expect(cls(failed)).toBe("failed");
    for (const refund of ["REFUNDED", "PARTIALLY_REFUNDED", "AUTO_REFUNDED"]) expect(cls(refund)).toBe("refund");
  });
  it("an explicit non-success status wins over ORDER_SUCCEEDED; unknown stays non-terminal", () => {
    expect(cls("PENDING")).toBe("unpaid_pending");
    expect(cls("WHATEVER")).toBe("unknown");
  });
  it("absent status is never inferred as success (held for reconciliation)", () => {
    expect(cls(undefined, "ORDER_SUCCEEDED")).toBe("unknown");
    expect(cls(undefined, "ORDER_FOO")).toBe("unknown");
    expect(cls("", "ORDER_SUCCEEDED")).toBe("unknown");
  });
});

// Default test environment: BREEZE_1CCO_ENABLED unset (feature OFF) and
// BREEZE_AMOUNT_UNIT unset (unit unconfirmed).
describe("webhook with the feature OFF and the amount unit unconfirmed", () => {
  const WEBHOOK_URL = "/api/v1/payments/breeze/order-create-webhook";
  const API_KEY = "test_breeze_webhook_api_key_do_not_use_in_prod";
  let app: typeof import("../../src/app.js").app;
  let db: typeof import("../../src/database/index.js");
  let T: typeof import("../../src/database/tables/index.js");

  beforeAll(async () => {
    db = await import("../../src/database/index.js");
    await db.connectDatabase();
    T = await import("../../src/database/tables/index.js");
    app = (await import("../../src/app.js")).app;
  });
  afterAll(async () => {
    await T.BreezeWebhookEvent.destroy({ where: {} });
    await T.BreezeCheckoutSession.destroy({ where: {} });
    await T.Cart.destroy({ where: {}, force: true });
    await db.disconnectDatabase();
  });

  it("session creation is hidden, but an authenticated paid event is held (503) without any financial mutation and with evidence kept", async () => {
    const hidden = await request(app).post("/api/v1/storefront/payments/breeze/checkout-session").send({});
    expect(hidden.status).toBe(404);

    const cart = await T.Cart.create({ id: 987001, status: "active", guest_token_hash: "g".repeat(64) } as never);
    await T.BreezeCheckoutSession.create({
      id: 987001,
      public_id: "e".repeat(32),
      user_id: null,
      guest_identity_hash: "g".repeat(64),
      cart_id: cart.id,
      cart_hash: "h".repeat(64),
      amount_paise: 50000,
      cart_snapshot: {},
      order_intent: { version: 1, lines: [], subtotalPaise: 50000, shippingFeePaise: 0, totalPaise: 50000, currency: "INR" },
      breeze_checkout_id: null,
      order_id: null,
      breeze_cart_id: null,
      breeze_order_id: null,
      breeze_txn_id: null,
      payment_id: null,
      last_event_id: null,
      last_error_code: null,
      expires_at: new Date(Date.now() + 3600_000)
    } as never);

    const address = { name: "A B", line1: "221B Baker Street", city: "Mumbai", state: "Maharashtra", country: "IN", postalCode: "400001", phoneNumber: "9876543210" };
    const res = await request(app)
      .post(WEBHOOK_URL)
      .set("X-Api-Key", API_KEY)
      .send({
        id: "evt-unit-gate",
        eventName: "ORDER_SUCCEEDED",
        content: {
          orderId: "bz-1",
          status: "SUCCESS",
          offers: [],
          payment: { paymentMethod: "UPI", paymentMethodType: "UPI", amount: 500, currency: "INR" },
          billingAddress: address,
          shippingAddress: address,
          customer: { customerId: "c", phoneNumber: "9876543210", countryCode: "+91" },
          cart: { id: "e".repeat(32), breezeCartId: "bzc", initialPrice: 500, totalPrice: 500, totalDiscount: 0, itemCount: 1, items: [], currency: "INR" }
        }
      });

    expect(res.status).toBe(503);
    // Scoped to this checkout: the shared test DB may hold rows from other files.
    expect(await T.Order.count({ where: { cart_id: 987001 } })).toBe(0);
    expect(await T.Payment.count({ where: { provider: "breeze", provider_order_id: "BRZC-" + "e".repeat(32) } })).toBe(0);
    const event = await T.BreezeWebhookEvent.findOne({ where: { event_id: "evt-unit-gate" } });
    expect(event?.status).toBe("received"); // kept replayable
    expect(event?.outcome_code).toBe("AMOUNT_UNIT_NOT_CONFIGURED");
    expect(event?.payload).toBeTruthy(); // evidence retained
  });
});
