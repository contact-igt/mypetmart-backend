import crypto from "node:crypto";

// PayU V1 refund/status hash formulas — verified 2026-08-17 against
// docs.payu.in/reference/refund_transaction_api and .../
// check_action_status_api_with_request_id: both commands on the same
// merchant postservice endpoint use the identical shape already established
// by payu-verify.client.ts's own verify_payment hash —
//   sha512(key|command|var1|salt)
// — just with a different `command` literal and `var1` meaning per command
// (mihpayid for cancel_refund_transaction, request_id for
// check_action_status_txnid).
export function buildPayuCommandHash(key: string, command: string, var1: string, salt: string): string {
  const source = `${key}|${command}|${var1}|${salt}`;
  return crypto.createHash("sha512").update(source, "utf8").digest("hex");
}
