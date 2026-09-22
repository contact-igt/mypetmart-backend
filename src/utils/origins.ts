/** Splits a comma-separated origin list (STOREFRONT_ORIGIN / ADMIN_ORIGIN) into trimmed, non-empty origins. */
export function parseOrigins(value: string): string[] {
  return stripWholeValueQuotes(value.trim())
    .split(",")
    .map((origin) => stripWrappingQuotes(origin.trim()))
    .filter(Boolean);
}

function stripWholeValueQuotes(value: string): string {
  const firstCharacter = value[0];
  if ((firstCharacter === '"' || firstCharacter === "'") && firstCharacter === value.at(-1) && !value.slice(1, -1).includes(firstCharacter)) {
    return value.slice(1, -1).trim();
  }

  return value;
}

function stripWrappingQuotes(value: string): string {
  const firstCharacter = value[0];
  const lastCharacter = value.at(-1);
  if ((firstCharacter === '"' || firstCharacter === "'") && firstCharacter === lastCharacter) {
    return value.slice(1, -1).trim();
  }

  return value;
}

/**
 * The first origin of a comma-separated list, without a trailing slash. Use this
 * — never the raw env value — wherever ONE absolute URL is needed (PayU surl/furl,
 * Breeze return URL, links inside emails); the full list is only valid for CORS.
 */
export function primaryOrigin(value: string): string {
  return (parseOrigins(value)[0] ?? "").replace(/\/+$/u, "");
}
