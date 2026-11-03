import { defineConfig } from "vitest/config";
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";

// Test credentials are deliberately separate from .env, which may be a
// developer's production-like local configuration. Never fall back to it.
if (existsSync(".env.test.local")) loadEnvFile(".env.test.local");

const requiredTestDbVariables = ["TEST_DB_HOST", "TEST_DB_PORT", "TEST_DB_USER", "TEST_DB_PASSWORD"] as const;
const missingTestDbVariables = requiredTestDbVariables.filter((name) => !process.env[name]?.trim());
if (missingTestDbVariables.length > 0) {
  throw new Error(`Missing ${missingTestDbVariables.join(", ")}. Configure dedicated credentials in ignored .env.test.local; tests will only target mypetmart_test.`);
}
if (process.env.TEST_DB_NAME && process.env.TEST_DB_NAME !== "mypetmart_test") {
  throw new Error("TEST_DB_NAME must be exactly mypetmart_test.");
}

process.env.NODE_ENV = "test";
process.env.DB_HOST = process.env.TEST_DB_HOST;
process.env.DB_PORT = process.env.TEST_DB_PORT;
process.env.DB_NAME = "mypetmart_test";
process.env.DB_USER = process.env.TEST_DB_USER;
process.env.DB_PASSWORD = process.env.TEST_DB_PASSWORD;
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
process.env.BREEZE_SHOP_URL = process.env.BREEZE_SHOP_URL || "https://mypetmart.in";
process.env.BREEZE_WEBHOOK_SECRET = process.env.BREEZE_WEBHOOK_SECRET || "test_breeze_webhook_api_key_do_not_use_in_prod";
// The developer .env carries its own Breeze values (loaded without overriding existing
// variables). Pin the test-sensitive ones so no run depends on local credentials: the
// order webhook key must equal the test secret, and the 1CCO flag/unit/key ids start
// unset (tests opt in with vi.stubEnv).
process.env.BREEZE_ORDER_WEBHOOK_API_KEY = process.env.BREEZE_WEBHOOK_SECRET;
process.env.BREEZE_ABANDONED_CHECKOUT_API_KEY = "test_breeze_abandoned_checkout_api_key_do_not_use_in_prod";
process.env.BREEZE_1CCO_ENABLED = "false";
process.env.BREEZE_AMOUNT_UNIT = "";
process.env.BREEZE_KEY_ID = "";
process.env.BREEZE_CART_PRIVATE_KEY = "";
// environment.config.ts already defaults SHIPMENT_NUMBER_PREFIX to "TEST-SHP"
// for any non-production NODE_ENV specifically so test-created shipment
// numbers can never be confused with a real courier reference — but only
// when the var is otherwise unset. The local .env file's own
// SHIPMENT_NUMBER_PREFIX=SHP (meant for a developer's real iThink sandbox
// testing via `npm run dev`) is loaded unconditionally regardless of
// NODE_ENV and was silently overriding that safety default during test
// runs. Setting it here — before environment.config.ts's loadEnvFile(".env")
// runs — wins, since Node's native loadEnvFile never overrides an
// already-set process.env value; this restores the intended TEST-SHP
// behavior for tests without touching the shared .env file.
process.env.SHIPMENT_NUMBER_PREFIX = process.env.SHIPMENT_NUMBER_PREFIX || "TEST-SHP";

export default defineConfig({
  test: {
    globalSetup: "./tests/global-setup.ts",
    // Per-file isolation (empty business tables) and SQL failure diagnostics.
    setupFiles: ["./tests/support/isolation.ts"],
    pool: "threads",
    fileParallelism: false,
    sequence: {
      concurrent: false
    }
  }
});
