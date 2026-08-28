import type { NormalizedPaymentResult } from "./payment.types.js";

export type BreezeEnvironment = string;

export type BreezePaymentRequestPayload = {
  merchantId: string;
  environment: BreezeEnvironment;
  merchantTransactionId: string;
  orderId: number;
  amount: string;
  currency: string;
  customer: {
    name: string;
    email: string;
    phone: string;
  };
  cartSignature?: string;
};

export const BREEZE_WEBHOOK_EVENT_TYPES = [
  "PAYMENT_SUCCESS",
  "PAYMENT_FAILED",
  "PAYMENT_CANCELLED",
  "PAYMENT_PENDING",
  "ORDER_SUCCEEDED",
  "ORDER_FAILED",
  "ORDER_CANCELLED"
] as const;

export type BreezeWebhookEventType = (typeof BREEZE_WEBHOOK_EVENT_TYPES)[number];

export type BreezeWebhookPayload = {
  event?: string;
  event_type?: string;
  type?: string;
  status?: string;
  transaction_id?: string;
  transactionId?: string;
  payment_id?: string;
  paymentId?: string;
  order_id?: string;
  orderId?: string;
  merchant_order_id?: string;
  merchantOrderId?: string;
  merchant_transaction_id?: string;
  merchantTransactionId?: string;
  amount?: string | number;
  currency?: string;
  method?: string | null;
  payment_method?: string | null;
  environment?: string;
  data?: Partial<BreezeWebhookPayload>;
};

export type BreezeSignaturePayload = {
  merchantId: string;
  environment: BreezeEnvironment;
  merchantTransactionId: string;
  amount: string;
  currency: string;
  orderId: number;
};

export type BreezeNormalizedResponseMapping = {
  raw: BreezeWebhookPayload;
  normalized: NormalizedPaymentResult;
};
