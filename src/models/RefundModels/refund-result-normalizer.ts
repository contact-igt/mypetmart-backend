import type { RawPayuRefundInitiateResponse, RawPayuRefundStatusDetail, RawPayuRefundStatusResponse } from "./payu-refund.client.js";
import type { NormalizedRefundOutcome, NormalizedRefundResult } from "./refund.types.js";

// Single source of truth for turning an untrusted/raw PayU refund shape
// (initiation response or Status API response) into the one normalized
// result RefundFinalizationService consumes — the refund-side mirror of
// payu-result-normalizer.ts.
function mapStatusApiOutcome(rawStatus: string | undefined): NormalizedRefundOutcome {
  switch ((rawStatus ?? "").trim().toUpperCase()) {
    case "SUCCESS":
      return "SUCCEEDED";
    case "FAILURE":
      return "FAILED";
    // QUEUED / IN PROGRESS / REQUESTED / od_hit / anything undocumented —
    // never guessed as SUCCEEDED/FAILED without clear provider evidence.
    default:
      return "PENDING";
  }
}

function isRefundStatusDetail(value: unknown): value is RawPayuRefundStatusDetail {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return ["status", "request_id", "amt", "mihpayid", "action"].some((field) => field in record);
}

function parseJsonValue(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function findDetailByRequestId(value: unknown, requestId: string, requestScoped: boolean, depth = 0): RawPayuRefundStatusDetail | null {
  if (depth > 4) return null;
  const parsed = parseJsonValue(value);

  if (isRefundStatusDetail(parsed)) {
    const detailRequestId = parsed.request_id === undefined ? "" : String(parsed.request_id).trim();
    return requestScoped || detailRequestId === requestId ? parsed : null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

  const record = parsed as Record<string, unknown>;
  if (requestId in record) {
    const exact = findDetailByRequestId(record[requestId], requestId, true, depth + 1);
    if (exact) return exact;
  }

  for (const child of Object.values(record)) {
    const match = findDetailByRequestId(child, requestId, requestScoped, depth + 1);
    if (match) return match;
  }
  return null;
}

function findStatusDetail(raw: RawPayuRefundStatusResponse, requestId: string): RawPayuRefundStatusDetail | null {
  return findDetailByRequestId(raw.transaction_details, requestId, false);
}

export function normalizeInitiateResponse(merchantRefundToken: string, raw: RawPayuRefundInitiateResponse): NormalizedRefundResult {
  // status 0 means PayU rejected the API call itself (bad amount, unknown
  // mihpayid, etc.) — a real, immediate failure of the initiation attempt,
  // not "uncertain". status 1 only ever means "accepted/queued", never
  // "money has moved" (see PayuRefundClient.initiateRefund).
  const outcome: NormalizedRefundOutcome = raw.status === 1 ? "PENDING" : "FAILED";
  return {
    merchantRefundToken,
    providerRequestId: raw.request_id || merchantRefundToken,
    providerRefundId: raw.request_id || null,
    providerStatus: raw.msg ?? "",
    normalizedOutcome: outcome,
    amount: null,
    verifiedAt: new Date(),
    verifiedVia: "initiate_response",
    safeMetadata: {
      bank_ref_num: raw.bank_ref_num ?? null,
      mihpayid: raw.mihpayid ?? null
    }
  };
}

export function normalizeStatusApiResponse(merchantRefundToken: string, requestId: string, raw: RawPayuRefundStatusResponse): NormalizedRefundResult {
  if (Number(raw.status) !== 1) {
    return {
      merchantRefundToken,
      providerRequestId: requestId,
      providerRefundId: null,
      providerStatus: raw.msg ?? "",
      normalizedOutcome: "PENDING",
      amount: null,
      verifiedAt: new Date(),
      verifiedVia: "status_api",
      safeMetadata: { apiMessage: raw.msg ?? null }
    };
  }

  const detail = findStatusDetail(raw, requestId);
  if (!detail) {
    return {
      merchantRefundToken,
      providerRequestId: requestId,
      providerRefundId: null,
      providerStatus: "",
      normalizedOutcome: "PENDING",
      amount: null,
      verifiedAt: new Date(),
      verifiedVia: "status_api",
      safeMetadata: {}
    };
  }

  return {
    merchantRefundToken,
    providerRequestId: requestId,
    providerRefundId: detail.mihpayid || null,
    providerStatus: detail.status ?? "",
    normalizedOutcome: mapStatusApiOutcome(detail.status),
    amount: detail.amt ?? null,
    verifiedAt: new Date(),
    verifiedVia: "status_api",
    safeMetadata: {
      mode: detail.mode ?? null,
      bank_ref_num: detail.bank_ref_num ?? null,
      bank_arn: detail.bank_arn ?? null,
      settlement_id: detail.settlement_id ?? null,
      refund_mode: detail.refund_mode ?? null
    }
  };
}
