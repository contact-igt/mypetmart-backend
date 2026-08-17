import crypto from "node:crypto";

// PayU Hosted Checkout request-hash formula, verified 2026-08-14 against
// PayU's published integration docs (docs.payu.in/docs/generate-hash-payu-hosted
// and docs.payu.in/docs/prebuilt-checkout-page-integration) rather than
// invented from memory — no repository-internal PayU Hosted Checkout
// parameter/hash contract existed prior to this file; the only prior PayU
// document in this repo (payu-inventory-contract.md) covers post-payment
// inventory finalization only, not request-hash construction.
//
// sha512(key|txnid|amount|productinfo|firstname|email|udf1|udf2|udf3|udf4|udf5||||||SALT)
//
// The hash string always carries exactly 5 UDF slots between email and salt
// regardless of how many UDFs are actually used, followed by 5 further empty
// slots before the salt (6 literal "|" characters after udf5) — unused slots
// are empty strings, never omitted, so the field count is always fixed.
export type PayuHashFields = {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
};

export function buildPayuRequestHashSource(fields: PayuHashFields, salt: string): string {
  const parts = [
    fields.key,
    fields.txnid,
    fields.amount,
    fields.productinfo,
    fields.firstname,
    fields.email,
    fields.udf1 ?? "",
    fields.udf2 ?? "",
    fields.udf3 ?? "",
    fields.udf4 ?? "",
    fields.udf5 ?? "",
    "",
    "",
    "",
    "",
    "",
    salt
  ];
  return parts.join("|");
}

export function buildPayuRequestHash(fields: PayuHashFields, salt: string): string {
  const source = buildPayuRequestHashSource(fields, salt);
  return crypto.createHash("sha512").update(source, "utf8").digest("hex");
}

// PayU Hosted Checkout response/webhook reverse-hash formula, verified
// 2026-08-14 against PayU's published docs (docs.payu.in/docs/
// working-with-response-after-a-customer-checkout) — the exact same fields
// as the request hash, in reverse order, with SALT first instead of last:
//
// sha512(SALT|status||||||udf5|udf4|udf3|udf2|udf1|email|firstname|productinfo|amount|txnid|key)
//
// Exactly five empty pipe-delimited slots follow `status` (the "||||||" run
// is six literal pipe characters, which delimits five empty fields — the
// same five reserved/unused slots the request hash carries after udf5, just
// relocated here), then UDF5→UDF1 in descending order (the mirror image of
// the ascending UDF1→UDF5 order in the request hash).
export type PayuResponseHashFields = PayuHashFields & { status: string };

export function buildPayuResponseHashSource(fields: PayuResponseHashFields, salt: string): string {
  const parts = [
    salt,
    fields.status,
    "",
    "",
    "",
    "",
    "",
    fields.udf5 ?? "",
    fields.udf4 ?? "",
    fields.udf3 ?? "",
    fields.udf2 ?? "",
    fields.udf1 ?? "",
    fields.email,
    fields.firstname,
    fields.productinfo,
    fields.amount,
    fields.txnid,
    fields.key
  ];
  return parts.join("|");
}

export function buildPayuResponseHash(fields: PayuResponseHashFields, salt: string): string {
  const source = buildPayuResponseHashSource(fields, salt);
  return crypto.createHash("sha512").update(source, "utf8").digest("hex");
}

/**
 * Verifies a PayU response/webhook hash in constant time. Never logs the
 * salt or the hash source string — only ever returns a boolean.
 */
export function verifyPayuResponseHash(fields: PayuResponseHashFields, salt: string, providedHash: string): boolean {
  const expected = buildPayuResponseHash(fields, salt);
  const expectedBuffer = Buffer.from(expected, "hex");
  const providedBuffer = Buffer.from(providedHash, "hex");
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
}
