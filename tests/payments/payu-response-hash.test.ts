import { describe, expect, it } from "vitest";

import { buildPayuResponseHash, buildPayuResponseHashSource, verifyPayuResponseHash } from "../../src/models/PaymentModels/payu-hash.util.js";

// Fixture and expected hash computed independently (a one-off Node script,
// not by calling the function under test) against PayU's published reverse
// formula, verified 2026-08-14 against
// docs.payu.in/docs/working-with-response-after-a-customer-checkout:
//   sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
const FIXTURE = {
  key: "testkey123",
  txnid: "PAY-000123",
  amount: "550.00",
  productinfo: "Test Product",
  firstname: "Jordan",
  email: "test@example.com",
  udf1: "42",
  status: "success"
};
const SALT = "testsalt456";
const EXPECTED_HASH =
  "1c016441f246647ce5d873a3c8ed0b5e7622bf93626d1423e2a07d72e514489ab7e54b683453f2f7c749d62c48031665982799185d49b179b66253966df67d35";
const EXPECTED_SOURCE = "testsalt456|success||||||||||42|test@example.com|Jordan|Test Product|550.00|PAY-000123|testkey123";

describe("PayU response/webhook reverse hash", () => {
  it("matches PayU's published reverse-hash formula for a known fixture", () => {
    expect(buildPayuResponseHash(FIXTURE, SALT)).toBe(EXPECTED_HASH);
  });

  it("produces the exact pipe-delimited source string PayU expects, with 17 delimiters", () => {
    const source = buildPayuResponseHashSource(FIXTURE, SALT);
    expect(source).toBe(EXPECTED_SOURCE);
    expect((source.match(/\|/g) ?? []).length).toBe(17);
  });

  it("treats missing udf2-udf5 as empty string slots (18 total fields), never omitting them", () => {
    const source = buildPayuResponseHashSource(FIXTURE, SALT);
    expect(source.split("|")).toHaveLength(18);
  });

  it("accepts the correct hash", () => {
    expect(verifyPayuResponseHash(FIXTURE, SALT, EXPECTED_HASH)).toBe(true);
  });

  it("rejects a tampered hash (single character flipped)", () => {
    const tampered = `${EXPECTED_HASH.slice(0, -1)}${EXPECTED_HASH.endsWith("a") ? "b" : "a"}`;
    expect(verifyPayuResponseHash(FIXTURE, SALT, tampered)).toBe(false);
  });

  it("rejects a hash computed for a different status (success vs failure)", () => {
    const failureHash = buildPayuResponseHash({ ...FIXTURE, status: "failure" }, SALT);
    expect(verifyPayuResponseHash(FIXTURE, SALT, failureHash)).toBe(false);
  });

  it("rejects a hash computed for a different amount", () => {
    const tamperedAmountHash = buildPayuResponseHash({ ...FIXTURE, amount: "1.00" }, SALT);
    expect(verifyPayuResponseHash(FIXTURE, SALT, tamperedAmountHash)).toBe(false);
  });

  it("rejects a hash computed with a different salt", () => {
    const wrongSaltHash = buildPayuResponseHash(FIXTURE, "a-different-salt");
    expect(verifyPayuResponseHash(FIXTURE, SALT, wrongSaltHash)).toBe(false);
  });

  it("rejects a malformed (non-hex or wrong-length) hash without throwing", () => {
    expect(verifyPayuResponseHash(FIXTURE, SALT, "not-a-hash")).toBe(false);
    expect(verifyPayuResponseHash(FIXTURE, SALT, "")).toBe(false);
  });

  it("is the exact reverse field order of the request hash (SALT first, key last)", () => {
    const source = buildPayuResponseHashSource(FIXTURE, SALT);
    expect(source.startsWith(SALT)).toBe(true);
    expect(source.endsWith(FIXTURE.key)).toBe(true);
  });
});
