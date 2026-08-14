import { defineConfig } from "vitest/config";

process.env.NODE_ENV = "test";
process.env.DB_NAME = "mypetmart_test";
// Deterministic PayU test credentials so Payment Initiation tests can build
// real Hosted Checkout fields/hashes without a live PayU account. Never
// falls back over a real local .env value if one is ever set.
process.env.PAYMENT_PROVIDER = process.env.PAYMENT_PROVIDER || "payu";
process.env.PAYMENT_KEY_ID = process.env.PAYMENT_KEY_ID || "test_payu_merchant_key";
process.env.PAYMENT_KEY_SECRET = process.env.PAYMENT_KEY_SECRET || "test_payu_merchant_salt_do_not_use_in_prod";

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
