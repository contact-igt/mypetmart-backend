import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { paymentConfig } from "../../src/config/payment.config.js";
import { PayuVerifyClient } from "../../src/models/PaymentModels/payu-verify.client.js";
import { normalizeVerifyApiResult } from "../../src/models/PaymentModels/payu-result-normalizer.js";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response;
}

describe("PayuVerifyClient.verifyPayment", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs to the Verify Payment API with the correct sha512(key|command|var1|salt) hash", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, transaction_details: {} }));

    await PayuVerifyClient.verifyPayment("PAY-000123");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(url as string).toBe(paymentConfig.verifyApiUrl);
    expect(options?.method).toBe("POST");

    const body = new URLSearchParams(options?.body as string);
    expect(body.get("key")).toBe(paymentConfig.payuKey);
    expect(body.get("command")).toBe("verify_payment");
    expect(body.get("var1")).toBe("PAY-000123");

    const expectedHash = crypto
      .createHash("sha512")
      .update(`${paymentConfig.payuKey}|verify_payment|PAY-000123|${paymentConfig.payuSalt}`, "utf8")
      .digest("hex");
    expect(body.get("hash")).toBe(expectedHash);
  });

  it("throws on a non-ok HTTP response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false));
    await expect(PayuVerifyClient.verifyPayment("PAY-000123")).rejects.toThrow();
  });
});

describe("normalizeVerifyApiResult", () => {
  it("maps a successful transaction to SUCCESS", () => {
    const result = normalizeVerifyApiResult("PAY-000123", {
      status: 1,
      transaction_details: { "PAY-000123": { mihpayid: "mihpay1", status: "success", amt: "550.00", mode: "UPI" } }
    });
    expect(result.normalizedOutcome).toBe("SUCCESS");
    expect(result.providerPaymentId).toBe("mihpay1");
    expect(result.amount).toBe("550.00");
    expect(result.verifiedVia).toBe("verify_api");
  });

  it("maps a failed transaction to FAILED", () => {
    const result = normalizeVerifyApiResult("PAY-000123", {
      status: 1,
      transaction_details: { "PAY-000123": { status: "failure" } }
    });
    expect(result.normalizedOutcome).toBe("FAILED");
  });

  it("treats a top-level API failure (status 0) as PENDING/uncertain, never FAILED", () => {
    const result = normalizeVerifyApiResult("PAY-000123", { status: 0, msg: "invalid key" });
    expect(result.normalizedOutcome).toBe("PENDING");
  });

  it("treats a 'Not Found' transaction sub-status as PENDING/uncertain, never FAILED", () => {
    const result = normalizeVerifyApiResult("PAY-000999", {
      status: 1,
      transaction_details: { "PAY-000999": { status: "Not Found" } }
    });
    expect(result.normalizedOutcome).toBe("PENDING");
  });

  it("treats a missing transaction_details entry as PENDING/uncertain, never FAILED", () => {
    const result = normalizeVerifyApiResult("PAY-000123", { status: 1, transaction_details: {} });
    expect(result.normalizedOutcome).toBe("PENDING");
  });

  it("never invents CANCELLED from an undocumented status string", () => {
    const result = normalizeVerifyApiResult("PAY-000123", {
      status: 1,
      transaction_details: { "PAY-000123": { status: "userCancelled" } }
    });
    expect(result.normalizedOutcome).toBe("PENDING");
  });
});
