export function parseStrictIdClaim(value: string | undefined): number {
  if (!value) {
    throw new Error("Missing ID claim");
  }
  if (!/^\d+$/u.test(value)) {
    throw new Error("Invalid ID claim format (digits only required)");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error("Invalid ID claim (must be safe positive integer)");
  }
  return parsed;
}
