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

function resolveGatewayUrl(): string {
  if (environmentConfig.PAYMENT_GATEWAY_URL) {
    return environmentConfig.PAYMENT_GATEWAY_URL;
  }
  return environmentConfig.NODE_ENV === "production" ? PAYU_LIVE_GATEWAY_URL : PAYU_TEST_GATEWAY_URL;
}

function resolveVerifyApiUrl(): string {
  return environmentConfig.NODE_ENV === "production" ? PAYU_LIVE_VERIFY_API_URL : PAYU_TEST_VERIFY_API_URL;
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
  keyIdConfigured: Boolean(environmentConfig.PAYMENT_KEY_ID),
  keySecretConfigured: Boolean(environmentConfig.PAYMENT_KEY_SECRET),
  webhookSecretConfigured: Boolean(environmentConfig.PAYMENT_WEBHOOK_SECRET),
  ready:
    Boolean(environmentConfig.PAYMENT_PROVIDER) &&
    Boolean(environmentConfig.PAYMENT_KEY_ID) &&
    Boolean(environmentConfig.PAYMENT_KEY_SECRET) &&
    Boolean(environmentConfig.PAYMENT_WEBHOOK_SECRET)
});
