// Provider money-unit adapter for Breeze 1CCO.
//
// The Breeze docs (Cart Signature, Order Create Webhook) type monetary fields
// as "Number" and never state the unit; their examples mix decimals (500.00)
// with a "paisa" note on a different (Abandoned Checkout) page. So the unit is
// an explicit, required setting (BREEZE_AMOUNT_UNIT) with NO default. Internally
// everything is integer paise — never float equality.

export type BreezeAmountUnit = "paise" | "rupees";

/** Integer paise -> the number Breeze expects, for the configured unit. */
export function toProviderAmount(paise: number, unit: BreezeAmountUnit): number {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new Error(`Invalid paise amount: ${paise}`);
  }
  return unit === "paise" ? paise : Number((paise / 100).toFixed(2));
}

/**
 * Provider value -> integer paise, strictly. Returns null for anything that is
 * not an exact representation in the configured unit (NaN, negative, wrong
 * precision, non-numeric string) so the caller can refuse to finalize.
 */
export function fromProviderAmount(value: unknown, unit: BreezeAmountUnit): number | null {
  let text: string;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value < 0) return null;
    text = String(value);
  } else if (typeof value === "string") {
    text = value.trim();
  } else {
    return null;
  }

  if (unit === "paise") {
    return /^\d{1,12}$/u.test(text) ? Number(text) : null;
  }

  const match = /^(\d{1,10})(?:\.(\d{1,2}))?$/u.exec(text);
  if (!match) return null;
  const rupees = Number(match[1]);
  const fraction = Number((match[2] ?? "").padEnd(2, "0") || "0");
  return rupees * 100 + fraction;
}

// Breeze Order Create callbacks report payment.amount in rupees, even when
// the signed cart is configured in paise.
export function fromBreezePaymentAmount(value: unknown): number | null {
  return fromProviderAmount(value, "rupees");
}
