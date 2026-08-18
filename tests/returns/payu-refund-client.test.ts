import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { paymentConfig } from "../../src/config/payment.config.js";
import { PayuRefundClient } from "../../src/models/RefundModels/payu-refund.client.js";
import { normalizeInitiateResponse, normalizeStatusApiResponse } from "../../src/models/RefundModels/refund-result-normalizer.js";

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) } as Response;
}

describe("PayuRefundClient.initiateRefund", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs cancel_refund_transaction to the same endpoint as Verify Payment, with the correct sha512(key|command|var1|salt) hash", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, request_id: "req_1", mihpayid: "mihpay1" }));

    await PayuRefundClient.initiateRefund("mihpay1", "REF-000123", "500.00", "https://api.example.com/webhook");

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = vi.mocked(fetch).mock.calls[0]!;
    expect(url as string).toBe(paymentConfig.refundApiUrl);
    expect(url as string).toBe(paymentConfig.verifyApiUrl); // confirms the deliberate endpoint reuse

    const body = new URLSearchParams(options?.body as string);
    expect(body.get("command")).toBe("cancel_refund_transaction");
    expect(body.get("var1")).toBe("mihpay1");
    expect(body.get("var2")).toBe("REF-000123");
    expect(body.get("var3")).toBe("500.00");
    expect(body.get("var5")).toBe("https://api.example.com/webhook");

    const expectedHash = crypto.createHash("sha512").update(`${paymentConfig.payuKey}|cancel_refund_transaction|mihpay1|${paymentConfig.payuSalt}`, "utf8").digest("hex");
    expect(body.get("hash")).toBe(expectedHash);
  });

  it("throws on a non-ok HTTP response", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({}, false));
    await expect(PayuRefundClient.initiateRefund("mihpay1", "REF-000123", "500.00", "https://api.example.com/webhook")).rejects.toThrow();
  });
});

describe("PayuRefundClient.checkRefundStatus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("POSTs check_action_status_txnid with var1=request_id and the correct hash", async () => {
    vi.mocked(fetch).mockResolvedValue(jsonResponse({ status: 1, transaction_details: {} }));

    await PayuRefundClient.checkRefundStatus("req_1");

    const [, options] = vi.mocked(fetch).mock.calls[0]!;
    const body = new URLSearchParams(options?.body as string);
    expect(body.get("command")).toBe("check_action_status_txnid");
    expect(body.get("var1")).toBe("req_1");
    const expectedHash = crypto.createHash("sha512").update(`${paymentConfig.payuKey}|check_action_status_txnid|req_1|${paymentConfig.payuSalt}`, "utf8").digest("hex");
    expect(body.get("hash")).toBe(expectedHash);
  });
});

describe("normalizeInitiateResponse", () => {
  it("maps status=1 (accepted/queued) to PENDING — never SUCCEEDED from initiation alone", () => {
    const result = normalizeInitiateResponse("REF-000123", { status: 1, request_id: "req_1", mihpayid: "mihpay1" });
    expect(result.normalizedOutcome).toBe("PENDING");
    expect(result.merchantRefundToken).toBe("REF-000123");
    expect(result.providerRequestId).toBe("req_1");
  });

  it("maps status=0 (PayU rejected the call itself) to FAILED", () => {
    const result = normalizeInitiateResponse("REF-000123", { status: 0, msg: "Invalid mihpayid" });
    expect(result.normalizedOutcome).toBe("FAILED");
  });
});

describe("normalizeStatusApiResponse", () => {
  it("maps SUCCESS to SUCCEEDED", () => {
    const result = normalizeStatusApiResponse("REF-000123", "req_1", {
      status: 1,
      transaction_details: { req_1: { status: "SUCCESS", amt: "500.00", mihpayid: "mihpay1" } }
    });
    expect(result.normalizedOutcome).toBe("SUCCEEDED");
    expect(result.amount).toBe("500.00");
  });

  it("maps FAILURE to FAILED", () => {
    const result = normalizeStatusApiResponse("REF-000123", "req_1", {
      status: 1,
      transaction_details: { req_1: { status: "FAILURE" } }
    });
    expect(result.normalizedOutcome).toBe("FAILED");
  });

  it.each(["QUEUED", "IN PROGRESS", "REQUESTED", "od_hit", "SomeUndocumentedValue"])(
    "never guesses SUCCEEDED/FAILED for the intermediate/undocumented status '%s' — always PENDING",
    (status) => {
      const result = normalizeStatusApiResponse("REF-000123", "req_1", {
        status: 1,
        transaction_details: { req_1: { status } }
      });
      expect(result.normalizedOutcome).toBe("PENDING");
    }
  );

  it("treats a top-level API failure (status 0) as PENDING/uncertain, never FAILED", () => {
    const result = normalizeStatusApiResponse("REF-000123", "req_1", { status: 0, msg: "unknown request_id" });
    expect(result.normalizedOutcome).toBe("PENDING");
  });

  it("treats a missing transaction_details entry as PENDING/uncertain, never FAILED", () => {
    const result = normalizeStatusApiResponse("REF-000123", "req_1", { status: 1, transaction_details: {} });
    expect(result.normalizedOutcome).toBe("PENDING");
  });
});
