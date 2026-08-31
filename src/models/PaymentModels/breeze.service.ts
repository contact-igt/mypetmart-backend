import { environmentConfig } from "../../config/environment.config.js";
import { paymentConfig } from "../../config/payment.config.js";
import { parseMoneyToPaise } from "../../utils/product-money.js";
import type { Order } from "../../database/tables/OrderTable/index.js";
import type { Payment } from "../../database/tables/PaymentTable/index.js";
import { PaymentProviderNotConfiguredError } from "./payment.errors.js";
import type { BreezeStartPaymentParamsJSON } from "./breeze.types.js";

/**
 * Breeze provider layer. Keeps all Breeze-specific payload shaping in one
 * place — the rest of PaymentModels stays provider-neutral.
 *
 * Scope (Phase B1): the documented `sendOTP -> verifyOTP -> startPayment`
 * Web SDK flow. All three actions run in the browser via @juspay/blaze-sdk-web
 * and talk to Breeze directly, so this backend module makes NO network calls
 * to Breeze. Its only job is to hand the storefront a set of
 * server-authoritative values to feed into the SDK.
 *
 * Documented parameter sources:
 *   - SDK init:      docs.breeze.in/web            (merchantId, shopUrl, environment)
 *   - startPayment:  docs.breeze.in/sdk-payload-helper
 *                    -> Independent -> "Start Payment Flow"
 */
export const BreezeService = {
  isConfigured(): boolean {
    return Boolean(paymentConfig.breezeMerchantId) && Boolean(paymentConfig.breezeEnvironment) && Boolean(paymentConfig.breezeWebhookSecret);
  },

  /**
   * Builds the safe browser-handoff payload for an already-resolved Breeze
   * Payment Attempt. Amount/currency/customer all come from the persisted
   * Order/Payment snapshot — never the request body — so the browser cannot
   * influence what Breeze is asked to charge.
   */
  buildStartPaymentParams(order: Order, payment: Payment): BreezeStartPaymentParamsJSON {
    if (!this.isConfigured()) {
      throw new PaymentProviderNotConfiguredError();
    }
    if (!payment.provider_order_id) {
      throw new Error("Breeze Payment Attempt is missing its provider transaction reference.");
    }

    // Breeze docs: startPayment.amount is "in smallest currency unit (paise
    // for INR). Example: 1000 = ₹10." Payment.amount is a decimal-rupee
    // string snapshotted from the Order at attempt creation.
    const amountPaise = parseMoneyToPaise(payment.amount);

    const rawPhone = order.ship_phone ? order.ship_phone.replace(/\D/gu, "") : "";
    // Breeze docs: customerPhone is "10 digits". Fall back defensively — the
    // Order should always have a valid phone (assertOrderPayable enforces it).
    const customerPhone = rawPhone.length >= 10 ? rawPhone.slice(-10) : rawPhone;

    const customerName = order.ship_recipient_name?.trim() || null;
    const customerEmail = order.contact_email?.trim() || null;

    return {
      provider: "breeze",
      merchantId: paymentConfig.breezeMerchantId as string,
      environment: paymentConfig.breezeEnvironment as string,
      shopUrl: paymentConfig.breezeShopUrl,
      orderRef: payment.provider_order_id,
      amountPaise,
      currency: payment.currency,
      customerPhone,
      customerEmail,
      customerName,
      // Backend-owned browser return target (never a client-supplied URL).
      // Points at the same non-authoritative result page the storefront
      // navigates to on the SDK `processResult` event — that page always
      // reconciles the real outcome via GET /storefront/payments/status.
      // TODO — BREEZE CONFIRMATION REQUIRED: whether startPayment on the Web
      // SDK actually performs a full-page redirect to returnUrl (and with
      // which query params), or completes inside the SDK overlay and only
      // emits `processResult`.
      returnUrl: `${environmentConfig.STOREFRONT_ORIGIN}/order/payment/result?provider=breeze&orderId=${order.id}`,
      orderId: order.id
    };
  }
};
