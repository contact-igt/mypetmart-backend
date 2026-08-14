export function formatMoney(amount: string | number): string {
  const num = typeof amount === "string" ? parseFloat(amount) : amount;
  if (isNaN(num) || !isFinite(num) || num < 0) {
    throw new Error(`Invalid money amount: ${amount}`);
  }
  return num.toFixed(2);
}

export function parseMoneyToPaise(amount: string | number): number {
  const formatted = formatMoney(amount);
  const parts = formatted.split(".");
  const rupees = parseInt(parts[0] ?? "0", 10);
  const paise = parseInt(parts[1] ?? "0", 10);
  return rupees * 100 + paise;
}

// Inverse of parseMoneyToPaise — the canonical paise-to-decimal-string formatter.
// Kept alongside it so integer-paise arithmetic (e.g. summing Order line totals)
// never has to round-trip through JS float math.
export function formatPaiseAsMoney(paise: number): string {
  if (!Number.isInteger(paise) || paise < 0) {
    throw new Error(`Invalid paise amount: ${paise}`);
  }
  const rupees = Math.floor(paise / 100);
  const cents = paise % 100;
  return `${rupees}.${String(cents).padStart(2, "0")}`;
}

export function compareMoney(a: string | number, b: string | number): number {
  const paiseA = parseMoneyToPaise(a);
  const paiseB = parseMoneyToPaise(b);
  if (paiseA < paiseB) return -1;
  if (paiseA > paiseB) return 1;
  return 0;
}

export function isCompareAtPriceValid(price: string | number, compareAtPrice: string | number | null | undefined): boolean {
  if (compareAtPrice === null || compareAtPrice === undefined || compareAtPrice === "") {
    return true;
  }
  return compareMoney(compareAtPrice, price) >= 0;
}
