import { defineConfig } from "vitest/config";

process.env.NODE_ENV = "test";
process.env.DB_NAME = "mypetmart_test";
// Deterministic PayU test credentials so Payment Initiation tests can build
// real Hosted Checkout fields/hashes without a live PayU account. Never
// falls back over a real local .env value if one is ever set.
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || "payu";
process.env.PAYMENT_KEY_ID = process.env.PAYMENT_KEY_ID || "test_payu_merchant_key";
process.env.PAYMENT_KEY_SECRET = process.env.PAYMENT_KEY_SECRET || "test_payu_merchant_salt_do_not_use_in_prod";
// Refund initiation additionally requires a public callback origin (see
// payment.config.ts's refundReady/refundWebhookUrl) — deterministic test
// value, never a real reachable address.
process.env.BACKEND_PUBLIC_ORIGIN = process.env.BACKEND_PUBLIC_ORIGIN || "https://backend.test.example.com";
// Deterministic Breeze test config (Breeze team's confirmed values, plus a
// non-real webhook API key). Lets Breeze initiation / webhook tests run
// without a live Breeze account. Breeze coexists with PayU — PAYMENT_PROVIDER
// stays "payu" above and PayU tests are unaffected.
process.env.BREEZE_MERCHANT_ID = process.env.BREEZE_MERCHANT_ID || "mypetmart";
process.env.BREEZE_ENVIRONMENT = process.env.BREEZE_ENVIRONMENT || "smb-release";
process.env.BREEZE_SHOP_URL = process.env.BREEZE_SHOP_URL || "https://mypetmart.org";
process.env.BREEZE_WEBHOOK_SECRET = process.env.BREEZE_WEBHOOK_SECRET || "test_breeze_webhook_api_key_do_not_use_in_prod";

export default defineConfig({
  test: {
    globalSetup: "./tests/global-setup.ts",
    pool: "threads",
    fileParallelism: false,
    sequence: {
      concurrent: false
    }
  }
});
