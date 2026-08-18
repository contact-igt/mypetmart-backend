import type { ReplacementStatus } from "../../constants/database.constants.js";

export type ReplacementJSON = {
  id: number;
  replacementNumber: string;
  status: ReplacementStatus;
  productId: number;
  productVariantId: number | null;
  quantity: number;
  stockConsumedAt: string | null;
  completedAt: string | null;
  createdAt: string;
};

export type UpdateReplacementInput = {
  status: "processing" | "completed";
};
