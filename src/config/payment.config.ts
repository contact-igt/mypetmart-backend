import { environmentConfig } from "./environment.config.js";

// PayU's published Hosted Checkout form-post endpoints (test vs. live) — see
// docs.payu.in/docs/prebuilt-checkout-page-integration. PAYMENT_GATEWAY_URL
// overrides this when a specific sandbox/live URL must be pinned.
const PAYU_TEST_GATEWAY_URL = "https://test.payu.in/_payment";
const PAYU_LIVE_GATEWAY_URL = "https://secure.payu.in/_payment";

// PayU's Verify Payment API lives on a different host/path than Hosted
// Checkout itself — see docs.payu.in/reference/verify_payment_api, verified
// 2026-08-14. Not overridable by PAYMENT_GATEWAY_URL (that var is specific to
// the Hosted Checkout form-post endpoint).
const PAYU_TEST_VERIFY_API_URL = "https://test.payu.in/merchant/postservice.php?form=2";
const PAYU_LIVE_VERIFY_API_URL = "https://info.payu.in/merchant/postservice.php?form=2";

// Single source of truth for "am I talking to PayU's live environment right
// now" — resolveGatewayUrl and resolveVerifyApiUrl must never answer this
// question independently again. Previously resolveVerifyApiUrl only checked
// NODE_ENV, so overriding PAYMENT_GATEWAY_URL to the live gateway (e.g. for
// a deliberate live smoke test from a non-production NODE_ENV) sent real
// live-mode payments out correctly but silently routed every Verify
// Payment / Refund Status / Refund Initiation call to PayU's TEST
// postservice endpoint using live credentials — PayU rejects that
// combination with a generic "Invalid Hash", and the failure was logged and
// swallowed (by design, for network-failure resilience), so reconciliation
// silently never completed. Confirmed by testing: the same request against
// the live postservice endpoint succeeds immediately.
function isLiveModeConfigured(): boolean {
  if (environmentConfig.PAYMENT_GATEWAY_URL) {
    return environmentConfig.PAYMENT_GATEWAY_URL === PAYU_LIVE_GATEWAY_URL;
  }
  return environmentConfig.NODE_ENV === "production";
}

function resolveGatewayUrl(): string {
  if (environmentConfig.PAYMENT_GATEWAY_URL) {
    return environmentConfig.PAYMENT_GATEWAY_URL;
  }
  return isLiveModeConfigured() ? PAYU_LIVE_GATEWAY_URL : PAYU_TEST_GATEWAY_URL;
}

function resolveVerifyApiUrl(): string {
  return isLiveModeConfigured() ? PAYU_LIVE_VERIFY_API_URL : PAYU_TEST_VERIFY_API_URL;
}

export const paymentConfig = Object.freeze({
  provider: environmentConfig.PAYMENT_PROVIDER,
  // PayU's own terms for the same two credentials: "key" (merchant key,
  // technically required in the browser-submitted form — never secret on its
  // own) and "salt" (merchant salt — server-only, must never leave the
  // backend). Aliased here rather than renamed at the environment layer so
  // the generic PAYMENT_KEY_ID / PAYMENT_KEY_SECRET vars already scaffolded
  // in .env.example keep working unchanged if a future provider replaces PayU.
  payuKey: environmentConfig.PAYMENT_KEY_ID,
  payuSalt: environmentConfig.PAYMENT_KEY_SECRET,
  gatewayUrl: resolveGatewayUrl(),
  verifyApiUrl: resolveVerifyApiUrl(),
  // Trusted, backend-configured browser return targets — never a
  // client-supplied callback URL, so PayU's surl/furl can never be used for
  // an open redirect. Reuses the already-validated storefront origin CORS
  // already trusts, plus fixed, backend-owned paths.
  successReturnUrl: `${environmentConfig.STOREFRONT_ORIGIN}/order/payment/success`,
  failureReturnUrl: `${environmentConfig.STOREFRONT_ORIGIN}/order/payment/failure`,
  // PayU's V1 refund API (cancel_refund_transaction / check_action_status_txnid)
  // is served by the exact same merchant postservice endpoint as Verify
  // Payment — confirmed 2026-08-17 against docs.payu.in/reference/
  // refund_transaction_api and .../check_action_status_api_with_request_id —
  // so it deliberately reuses verifyApiUrl rather than introducing a second,
  // redundant URL config.
  refundApiUrl: resolveVerifyApiUrl(),
  // PayU's cancel_refund_transaction requires a callback URL (var5) it can
  // reach to post refund status updates. Only meaningful when this backend
  // has a public address — see BACKEND_PUBLIC_ORIGIN in environment.config.ts.
  refundWebhookUrl: environmentConfig.BACKEND_PUBLIC_ORIGIN ? `${environmentConfig.BACKEND_PUBLIC_ORIGIN}/api/v1/payments/payu/refund-webhook` : undefined,
  returnWindowDays: environmentConfig.RETURN_WINDOW_DAYS,
  keyIdConfigured: Boolean(environmentConfig.PAYMENT_KEY_ID),
  keySecretConfigured: Boolean(environmentConfig.PAYMENT_KEY_SECRET),
  webhookSecretConfigured: Boolean(environmentConfig.PAYMENT_WEBHOOK_SECRET),
  ready:
    Boolean(environmentConfig.PAYMENT_PROVIDER) &&
    Boolean(environmentConfig.PAYMENT_KEY_ID) &&
    Boolean(environmentConfig.PAYMENT_KEY_SECRET) &&
    Boolean(environmentConfig.PAYMENT_WEBHOOK_SECRET),
  // Refund initiation additionally requires a reachable public callback URL —
  // never silently degrades to "no webhook" for a real-money operation.
  refundReady: Boolean(environmentConfig.PAYMENT_PROVIDER) && Boolean(environmentConfig.PAYMENT_KEY_ID) && Boolean(environmentConfig.PAYMENT_KEY_SECRET) && Boolean(environmentConfig.BACKEND_PUBLIC_ORIGIN)
});
