import { describe, expect, it } from "vitest";

import { parseOrigins, primaryOrigin } from "./origins.js";

describe("origins", () => {
  it("splits and trims a comma-separated list", () => {
    expect(parseOrigins(" https://a.in , https://b.in,, ")).toEqual(["https://a.in", "https://b.in"]);
  });

  it("accepts whole-value and per-origin quotes from deployment variable UIs", () => {
    expect(parseOrigins('"https://a.in,https://b.in"')).toEqual(["https://a.in", "https://b.in"]);
    expect(parseOrigins('"https://a.in", "https://b.in"')).toEqual(["https://a.in", "https://b.in"]);
  });

  it("primaryOrigin returns only the first origin (the value PayU surl/furl were wrongly built from)", () => {
    expect(primaryOrigin("https://www.mypetmart.in,https://mypetmart-frontend-web.vercel.app,http://localhost:3000")).toBe("https://www.mypetmart.in");
  });

  it("primaryOrigin strips trailing slashes and works for a single origin", () => {
    expect(primaryOrigin("https://www.mypetmart.in/")).toBe("https://www.mypetmart.in");
    expect(primaryOrigin("http://localhost:3000")).toBe("http://localhost:3000");
  });
});
