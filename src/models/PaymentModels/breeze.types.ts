import type { NormalizedPaymentResult } from "./payment.types.js";

export type BreezeEnvironment = string;

// ---------------------------------------------------------------------------
// Breeze startPayment handoff (server -> browser)
// ---------------------------------------------------------------------------

// The safe, server-authoritative values the storefront needs to (a) initialize
// the Breeze Web SDK and (b) call the documented `startPayment` action. Every
// field here originates from the persisted Order/Payment snapshot or from
// backend config — never from the request body. No secret is ever included:
// Breeze confirmed the Web SDK requires no frontend key, and the webhook
// secret / any private key stay on the backend.
//
// Documented sources:
//   - SDK init: docs.breeze.in/web  (merchantId, shopUrl, environment)
//   - startPayment: docs.breeze.in/sdk-payload-helper -> Independent ->
//     "Start Payment Flow"  (orderId, amount [paise], currency, customerId,
//     customerPhone, customerEmail?, customerName?, returnUrl?, paymentMethods?)
export type BreezeStartPaymentParamsJSON = {
  provider: "breeze";
  // Breeze Web SDK initiate() payload.
  merchantId: string;
  environment: BreezeEnvironment;
  shopUrl: string;
  // startPayment payload — authoritative values only.
  orderRef: string; // our Payment.provider_order_id (BRZ-xxxxxx-<rand>); passed as startPayment.orderId
  amountPaise: number; // startPayment.amount — "smallest currency unit (paise for INR)"
  currency: string; // startPayment.currency
  customerPhone: string; // startPayment.customerPhone — 10 digits, from Order.ship_phone
  customerEmail: string | null; // startPayment.customerEmail (optional in Breeze docs)
  customerName: string | null; // startPayment.customerName (optional in Breeze docs)
  // Backend-owned browser return target (never a client-supplied URL).
  returnUrl: string;
  // Our internal numeric Order id — the storefront uses this only to poll
  // GET /storefront/payments/status for the server-verified outcome.
  orderId: number;
};

// ---------------------------------------------------------------------------
// Breeze S2S webhook — "Order Create Webhook" (docs.breeze.in -> Order Create
// Webhook). Documented request shape:
//
//   headers: Content-Type: application/json, X-Api-Key: <your API key>
//   body:    { id, eventName, content: OrderCreateContent }
//
//   OrderCreateContent: { orderId, txnId?, status (OrderStatus), offers[],
//     payment: PaymentDetail, billingAddress, shippingAddress,
//     shippingDetails?, customer, cart, gstDetails? }
//   PaymentDetail:      { paymentMethod, paymentMethodType, amount, currency }
//
// TODO — BREEZE CONFIRMATION REQUIRED:
//   1. Whether the "Order Create Webhook" fires for the sendOTP -> verifyOTP
//      -> startPayment path (the docs frame it around full 1CCO order
//      placement), or whether a different/simpler payment webhook is used.
//   2. Which field (content.txnId | content.orderId | content.cart.id)
//      corresponds to the merchant transaction reference we sent as
//      startPayment.orderId (== Payment.provider_order_id). The normalizer
//      below tries them in order; the finalizer safely rejects an unmatched
//      reference without any mutation.
//   3. The exact success-acknowledgement response body Breeze expects
//      (docs say "200 with OrderStatus + CreateOrderResponseContent" but do
//      not fully enumerate CreateOrderResponseContent).
// ---------------------------------------------------------------------------

// OrderStatus vocabulary from docs.breeze.in -> "Order Status".
export const BREEZE_ORDER_STATUS_VALUES = [
  "PENDING",
  "PAYMENT_SUCCESS",
  "SUCCESS",
  "PARTIALLY_PAID",
  "FAILED",
  "CANCELLED"
] as const;
export type BreezeOrderStatus = (typeof BREEZE_ORDER_STATUS_VALUES)[number];

export type BreezeWebhookPaymentDetail = {
  paymentMethod?: string;
  paymentMethodType?: string;
  amount?: string | number;
  currency?: string;
};

export type BreezeWebhookCart = {
  id?: string;
  breezeCartId?: string;
  totalPrice?: string | number;
};

export type BreezeWebhookContent = {
  orderId?: string;
  txnId?: string;
  status?: string;
  payment?: BreezeWebhookPaymentDetail;
  cart?: BreezeWebhookCart;
  [key: string]: unknown;
};

export type BreezeWebhookPayload = {
  id?: string;
  eventName?: string;
  content?: BreezeWebhookContent;
  // Some Breeze webhook shapes nest the same object under `eventData` /
  // `data` (observed in the docs' Platform Webhook examples). Kept optional
  // so the normalizer can look there too without inventing a contract.
  eventData?: BreezeWebhookContent;
  data?: BreezeWebhookContent;
};

export type BreezeNormalizedResponseMapping = {
  raw: BreezeWebhookPayload;
  normalized: NormalizedPaymentResult;
};
