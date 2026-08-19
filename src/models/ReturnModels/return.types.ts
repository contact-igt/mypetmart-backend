import type { ReturnStatus } from "../../constants/database.constants.js";
import type { ReplacementJSON } from "../ReplacementModels/replacement.types.js";

// Guest Returns are explicitly deferred (no approved guest-Order-recovery
// path for post-delivery service actions exists yet — see the Returns +
// Refunds report §22). Every Return caller is therefore an authenticated
// customer; unlike PaymentInitiationCaller there is no "guest" variant.
export type ReturnCaller = { userId: number };

export type CreateReturnRequestInput = {
  orderId: number;
  orderItemId: number;
  quantity: number;
  reason: string;
  resolution?: "refund" | "replacement" | undefined;
};

export type ReturnRefundSummaryJSON = {
  id: number;
  refundNumber: string;
  status: "pending" | "processing" | "succeeded" | "failed";
  amount: string;
  currency: string;
  initiatedAt: string;
  completedAt: string | null;
  failedAt: string | null;
  failureMessage: string | null;
};

export type ReturnNoteJSON = {
  id: number;
  message: string;
  authorName: string;
  createdAt: string;
};

export type ReturnRequestJSON = {
  id: number;
  returnNumber: string;
  orderId: number;
  orderNumber: string;
  orderItemId: number;
  productName: string;
  variantName: string | null;
  purchasedQuantity: number;
  quantity: number;
  resolution: "refund" | "replacement";
  status: ReturnStatus;
  reason: string;
  resolutionNote: string | null;
  requestedAt: string;
  resolvedAt: string | null;
  itemReceivedAt: string | null;
  refunds: ReturnRefundSummaryJSON[];
  replacement: ReplacementJSON | null;
};

export type ReturnRequestDetailJSON = ReturnRequestJSON & {
  notes: ReturnNoteJSON[];
  // Backend-computed, echoed back for the Admin refund-initiation UI —
  // never client-suppliable (spec §14: refund amount is always
  // backend-derived from the immutable OrderItem price snapshot).
  maxRefundableAmount: string;
  currency: string;
};

export type AdminReviewReturnAction = "approve" | "reject";

export type AdminReviewReturnInput = {
  action: AdminReviewReturnAction;
  note?: string | undefined;
};

export type ListReturnsParams = {
  status?: ReturnStatus | undefined;
  resolution?: "refund" | "replacement" | undefined;
  page: number;
  pageSize: number;
};

export type ListReturnsResultJSON = {
  items: ReturnRequestJSON[];
  page: number;
  pageSize: number;
  total: number;
};
