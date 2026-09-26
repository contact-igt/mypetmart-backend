// In production the storefront (www.mypetmart.in) and the API (a different
// site) are cross-site, so every cookie the API sets is a third-party cookie.
// Browsers that block third-party cookies (Chrome Incognito, Safari, Brave)
// silently drop plain SameSite=None cookies — guests then lose their cart on
// the next request and customers lose their session on reload. Partitioned
// (CHIPS) cookies are still accepted there, scoped to the storefront's site.
import type { Response } from "express";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/environment.config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/config/environment.config.js")>();
  return { ...actual, environmentConfig: { ...actual.environmentConfig, NODE_ENV: "production" } };
});

import { CookieService } from "../../src/services/auth/cookie.service.js";
import { clearGuestCartCookie, resolveCartIdentity } from "../../src/middlewares/cart/resolve-cart-identity.middleware.js";

type CookieCall = { kind: "set" | "clear"; name: string; options: Record<string, unknown> };

function fakeResponse(): { res: Response; calls: CookieCall[] } {
  const calls: CookieCall[] = [];
  const res = {
    cookie: (name: string, _value: string, options: Record<string, unknown>) => { calls.push({ kind: "set", name, options }); return res; },
    clearCookie: (name: string, options: Record<string, unknown>) => { calls.push({ kind: "clear", name, options }); return res; }
  } as unknown as Response;
  return { res, calls };
}

function expectCrossSitePartitioned(call: CookieCall): void {
  expect(call.options).toMatchObject({ secure: true, sameSite: "none", partitioned: true });
}

describe("production cross-site cookies are Partitioned (CHIPS)", () => {
  it("guest cart cookie minted for a new guest", async () => {
    const { res, calls } = fakeResponse();
    const next = vi.fn();
    await resolveCartIdentity()({ headers: {}, cookies: {} } as never, res, next);
    expect(next).toHaveBeenCalled();
    const set = calls.find((c) => c.kind === "set");
    expect(set).toBeDefined();
    expectCrossSitePartitioned(set!);
  });

  it("guest cart cookie clear", () => {
    const { res, calls } = fakeResponse();
    clearGuestCartCookie(res);
    expectCrossSitePartitioned(calls[0]!);
  });

  it("customer and admin refresh cookies are set Partitioned and the legacy unpartitioned copy is cleared", () => {
    for (const sessionType of ["customer", "admin"] as const) {
      const { res, calls } = fakeResponse();
      CookieService.setRefreshCookie(res, "token", sessionType);
      const set = calls.find((c) => c.kind === "set")!;
      expectCrossSitePartitioned(set);
      // Browsers keep a pre-existing unpartitioned cookie separately; clear it
      // so an old (rotated/revoked) refresh token can never shadow the new one.
      expect(calls.some((c) => c.kind === "clear" && c.name === set.name && !c.options.partitioned)).toBe(true);

      const cleared = fakeResponse();
      CookieService.clearRefreshCookie(cleared.res, sessionType);
      expect(cleared.calls.some((c) => c.options.partitioned === true)).toBe(true);
    }
  });

  it("password reset and recovery cookies", () => {
    const { res, calls } = fakeResponse();
    CookieService.setResetCookie(res, "t");
    CookieService.clearResetCookie(res);
    CookieService.setRecoveryCookie(res, "t");
    CookieService.clearRecoveryCookie(res);
    expect(calls).toHaveLength(4);
    calls.forEach(expectCrossSitePartitioned);
  });
});
