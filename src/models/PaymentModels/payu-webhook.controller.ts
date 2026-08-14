import type { NextFunction, Request, Response } from "express";

import { paymentConfig } from "../../config/payment.config.js";
import { logger } from "../../utils/logger.js";
import { PaymentFinalizationService } from "./payment-finalization.service.js";
import { verifyPayuResponseHash } from "./payu-hash.util.js";
import { normalizeWebhookResult, type RawPayuWebhookBody } from "./payu-result-normalizer.js";

const REQUIRED_FIELDS: (keyof RawPayuWebhookBody)[] = ["status", "txnid", "amount", "email", "firstname", "productinfo", "hash"];

/**
 * PayU payment success/failure webhook. Public, provider-facing — never
 * customer/admin authenticated (see routes file). PayU expects a plain HTTP
 * 200 with an empty body to acknowledge receipt, retrying up to 3 times
 * otherwise (docs.payu.in/docs/webhooks). Every branch below that has
 * durably and permanently resolved the request (missing fields, bad hash,
 * unknown txnid, amount mismatch, or a normal processed outcome) acks 200 —
 * a PayU retry cannot change any of those verdicts. Only a genuine
 * transient failure on our side (misconfiguration, unexpected exception)
 * returns a non-2xx so PayU's retry is actually useful.
 */
export async function handlePayuWebhook(req: Request, res: Response, _next: NextFunction): Promise<void> {
  const body = req.body as RawPayuWebhookBody;

  const missing = REQUIRED_FIELDS.filter((field) => !body[field]);
  if (missing.length > 0) {
    logger.warn({ missingFieldCount: missing.length }, "payu webhook: missing required field(s), acked without processing");
    res.status(200).end();
    return;
  }

  if (!paymentConfig.payuKey || !paymentConfig.payuSalt) {
    logger.error("payu webhook: payment provider not configured");
    res.status(503).end();
    return;
  }

  const hashValid = verifyPayuResponseHash(
    {
      key: paymentConfig.payuKey,
      txnid: body.txnid as string,
      amount: body.amount as string,
      productinfo: body.productinfo as string,
      firstname: body.firstname as string,
      email: body.email as string,
      ...(body.udf1 !== undefined ? { udf1: body.udf1 } : {}),
      ...(body.udf2 !== undefined ? { udf2: body.udf2 } : {}),
      ...(body.udf3 !== undefined ? { udf3: body.udf3 } : {}),
      ...(body.udf4 !== undefined ? { udf4: body.udf4 } : {}),
      ...(body.udf5 !== undefined ? { udf5: body.udf5 } : {}),
      status: body.status as string
    },
    paymentConfig.payuSalt,
    body.hash as string
  );

  if (!hashValid) {
    logger.warn({ txnid: body.txnid }, "payu webhook: hash verification failed, rejected without mutation");
    res.status(200).end();
    return;
  }

  try {
    const normalized = normalizeWebhookResult(body);
    const outcome = await PaymentFinalizationService.processVerifiedPaymentResult(normalized);
    logger.info({ txnid: body.txnid, outcomeCode: outcome.code, paymentAttemptId: outcome.paymentId, orderId: outcome.orderId }, "payu webhook: processed");
    res.status(200).end();
  } catch (error) {
    logger.error({ err: error, txnid: body.txnid }, "payu webhook: internal error processing verified result");
    res.status(500).end();
  }
}
