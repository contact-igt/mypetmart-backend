import { beforeEach, describe, expect, it, vi } from "vitest";

const mockedShipmentConfig = vi.hoisted(() => ({ numberPrefix: "TEST-SHP" }));

vi.mock("../config/shipment.config.js", () => ({
  shipmentConfig: mockedShipmentConfig
}));

import { buildBusinessReference } from "./reference-generator.js";

describe("shipment business references", () => {
  beforeEach(() => {
    mockedShipmentConfig.numberPrefix = "TEST-SHP";
  });

  it("uses the configured test prefix and preserves six-digit padding", () => {
    expect(buildBusinessReference("shipment", 1)).toBe("TEST-SHP-000001");
    expect(buildBusinessReference("shipment", 42)).toBe("TEST-SHP-000042");
  });

  it("uses the configured production prefix", () => {
    mockedShipmentConfig.numberPrefix = "SHP";
    expect(buildBusinessReference("shipment", 1)).toBe("SHP-000001");
  });

  it("does not change other business reference prefixes", () => {
    expect(buildBusinessReference("order", 1)).toBe("ORD-000001");
    expect(buildBusinessReference("replacement", 1)).toBe("RPL-000001");
  });
});
