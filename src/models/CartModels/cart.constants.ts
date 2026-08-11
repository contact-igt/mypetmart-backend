// No existing project-wide "max order quantity" convention exists (Product/Variant place no cap).
// 20 is a conservative, documented default chosen for this module rather than an env var, per
// task scope: a per-line cap is a business constant, not deployment configuration.
export const MAX_CART_ITEM_QUANTITY = 20;

// Scoped to all of /storefront, not just /storefront/cart: Checkout (and any future
// guest-aware storefront route) resolves the same guest identity via the same cookie,
// so the cookie must be sent on those requests too.
export const CART_GUEST_COOKIE_PATH = "/api/v1/storefront";

// 30 days: long enough to survive a typical guest browsing session without becoming stale.
export const CART_GUEST_COOKIE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
