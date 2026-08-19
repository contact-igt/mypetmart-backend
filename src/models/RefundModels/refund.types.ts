import type { RefundStatus } from "../../constants/database.constants.js";

// PayU's own refund-lifecycle vocabulary (QUEUED/SUCCESS/FAILURE/IN
// PROGRESS/REQUESTED/od_hit — docs.payu.in/reference/
// check_action_status_api_with_request_id, verified 2026-08-17) collapses
// onto this codebase's three-state Refund model. Never invented as
// SUCCEEDED/FAILED without clear provider evidence — mirrors
// NormalizedPaymentOutcome's same PENDING-by-default discipline.
export type NormalizedRefundOutcome = "SUCCEEDED" | "FAILED" | "PENDING";

export type NormalizedRefundResult = {
  // The Refund row lookup key — our own provider_refund_token, echoed back
  // by PayU on every surface (initiation caller already knows it; the
  // Status API caller passes it through; the refund webhook's own `token`
  // field is this exact same value per docs.payu.in/reference/
  // refund-status-callback, verified 2026-08-17).
  merchantRefundToken: string;
  providerRequestId: string;
  providerRefundId: string | null;
  providerStatus: string;
  normalizedOutcome: NormalizedRefundOutcome;
  amount: string | null;
  verifiedAt: Date;
  verifiedVia: "initiate_response" | "status_api" | "webhook";
  safeMetadata: Record<string, unknown>;
};

export type RefundFinalizationResultCode =
  | "SUCCEEDED_RECORDED"
  | "PROCESSING_RECORDED"
  | "FAILED_RECORDED"
  | "NOOP_ALREADY_TERMINAL"
  | "NOOP_UNCERTAIN"
  | "REJECTED_UNKNOWN_REFUND"
  | "REJECTED_AMOUNT_MISMATCH";

export type RefundFinalizationOutcome = {
  code: RefundFinalizationResultCode;
  refundId: number | null;
  returnRequestId: number | null;
};

export type InitiateRefundInput = {
  returnRequestId: number;
};

export type InitiateRefundResultJSON = {
  id: number;
  refundNumber: string;
  status: RefundStatus;
  amount: string;
  currency: string;
};
