import { describe, expect, it, vi } from "vitest";

// ADMIN_ORIGIN doubles as the CORS allow-list, so it may hold several
// comma-separated origins. Email deep links must use only the first one.
vi.mock("../../src/config/environment.config.js", () => ({
  environmentConfig: {
    ADMIN_ORIGIN: "https://admin.mypetmart.in/, https://mypetmart-admin.vercel.app,http://localhost:4000"
  }
}));

const { getAdminOrderCancelledTemplate } = await import("../../src/services/email/admin-email.templates.js");

describe("admin email order link", () => {
  it("links to the first ADMIN_ORIGIN entry only", () => {
    const template = getAdminOrderCancelledTemplate({
      orderId: 26,
      orderNumber: "ORD-26",
      buyerLabel: "Test Customer",
      total: "499.00",
      currency: "INR",
      cancelledBy: "customer",
      paymentContext: "No payment attempt",
      cancelledAt: "2026-09-29"
    });

    expect(template.text).toContain("Manage: https://admin.mypetmart.in/admin/orders/26");
    expect(template.html).toContain('href="https://admin.mypetmart.in/admin/orders/26"');
    expect(template.text).not.toContain("vercel.app");
    expect(template.html).not.toContain("localhost:4000");
  });
});
