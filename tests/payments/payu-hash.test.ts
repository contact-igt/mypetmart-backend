import { describe, expect, it } from "vitest";

import { buildPayuRequestHash, buildPayuRequestHashSource } from "../../src/models/PaymentModels/payu-hash.util.js";

// Fixture values and the expected hash below were computed independently
// (a one-off Node script, not by calling the function under test) against
// PayU's published formula:
//   sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
// verified 2026-08-14 against docs.payu.in/docs/generate-hash-payu-hosted and
// docs.payu.in/docs/prebuilt-checkout-page-integration.
const FIXTURE = {
  key: "testkey123",
  txnid: "PAY-000123",
  amount: "550.00",
  productinfo: "Test Product",
  firstname: "Jordan",
  email: "test@example.com",
  udf1: "42"
};
const SALT = "testsalt456";
const EXPECTED_HASH =
  "29bea52fd4325bd9e9fe672342f83b703856ba11b2d259243110c3af7da4c63c31fbbc19dfc195d8b31be456e1c8eecfe26acfc835d2cb7f78caad9fe732a1e5";
const EXPECTED_SOURCE = "testkey123|PAY-000123|550.00|Test Product|Jordan|test@example.com|42||||||||||testsalt456";

describe("PayU request hash", () => {
  it("matches PayU's published Hosted Checkout formula for a known fixture", () => {
    expect(buildPayuRequestHash(FIXTURE, SALT)).toBe(EXPECTED_HASH);
  });

  it("produces the exact pipe-delimited source string PayU expects, with 16 delimiters", () => {
    const source = buildPayuRequestHashSource(FIXTURE, SALT);
    expect(source).toBe(EXPECTED_SOURCE);
    expect((source.match(/\|/g) ?? []).length).toBe(16);
  });

  it("treats missing udf2-udf5 as empty string slots, never omitting them", () => {
    const source = buildPayuRequestHashSource(FIXTURE, SALT);
    // key,txnid,amount,productinfo,firstname,email,udf1..udf5(5),then 5 more empty,then salt = 17 fields
    expect(source.split("|")).toHaveLength(17);
  });

  it("changes the hash when the signed amount changes", () => {
    const original = buildPayuRequestHash(FIXTURE, SALT);
    const tampered = buildPayuRequestHash({ ...FIXTURE, amount: "1.00" }, SALT);
    expect(tampered).not.toBe(original);
  });

  it("changes the hash when the salt changes", () => {
    const original = buildPayuRequestHash(FIXTURE, SALT);
    const tampered = buildPayuRequestHash(FIXTURE, "a-different-salt");
    expect(tampered).not.toBe(original);
  });

  it("changes the hash when txnid changes", () => {
    const original = buildPayuRequestHash(FIXTURE, SALT);
    const tampered = buildPayuRequestHash({ ...FIXTURE, txnid: "PAY-999999" }, SALT);
    expect(tampered).not.toBe(original);
  });

  it("is deterministic for identical input", () => {
    expect(buildPayuRequestHash(FIXTURE, SALT)).toBe(buildPayuRequestHash({ ...FIXTURE }, SALT));
  });
});
