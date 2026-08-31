import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/config/payment.config.js", () => ({
  paymentConfig: {
    breezeMerchantId: "mypetmart",
    breezeEnvironment: "smb-release",
    breezeShopUrl: "https://mypetmart.org",
    breezeWebhookSecret: "test_breeze_api_key",
    successReturnUrl: "https://shop.test.example.com/order/payment/success"
  }
}));

vi.mock("../../src/config/environment.config.js", () => ({
  environmentConfig: { STOREFRONT_ORIGIN: "https://shop.test.example.com" }
}));

const { BreezeService } = await import("../../src/models/PaymentModels/breeze.service.js");

type OrderLike = Parameters<typeof BreezeService.buildStartPaymentParams>[0];
type PaymentLike = Parameters<typeof BreezeService.buildStartPaymentParams>[1];

function order(overrides: Partial<Record<string, unknown>> = {}): OrderLike {
  return {
    id: 42,
    ship_phone: "+91 98765 43210",
    ship_recipient_name: "Jordan Rivera",
    contact_email: "jordan@example.com",
    ...overrides
  } as unknown as OrderLike;
}

function payment(overrides: Partial<Record<string, unknown>> = {}): PaymentLike {
  return {
    provider_order_id: "BRZ-000042-abcdef0123",
    amount: "737.50",
    currency: "INR",
    ...overrides
  } as unknown as PaymentLike;
}

describe("BreezeService.buildStartPaymentParams", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns server-authoritative values in the documented startPayment shape", () => {
    const params = BreezeService.buildStartPaymentParams(order(), payment());
    expect(params).toMatchObject({
      provider: "breeze",
      merchantId: "mypetmart",
      environment: "smb-release",
      shopUrl: "https://mypetmart.org",
      orderRef: "BRZ-000042-abcdef0123",
      amountPaise: 73750, // 737.50 -> paise, per Breeze docs "smallest currency unit"
      currency: "INR",
      customerPhone: "9876543210", // last 10 digits only
      customerEmail: "jordan@example.com",
      customerName: "Jordan Rivera",
      orderId: 42
    });
    expect(params.returnUrl).toContain("/order/payment/result");
    expect(params.returnUrl).toContain("provider=breeze");
  });

  it("normalizes phone to the last 10 digits and tolerates a missing email/name", () => {
    const params = BreezeService.buildStartPaymentParams(
      order({ ship_phone: "0091-99999-88888", contact_email: null, ship_recipient_name: "  " }),
      payment()
    );
    expect(params.customerPhone).toBe("9999988888");
    expect(params.customerEmail).toBeNull();
    expect(params.customerName).toBeNull();
  });

  it("throws if the attempt has no provider reference", () => {
    expect(() => BreezeService.buildStartPaymentParams(order(), payment({ provider_order_id: null }))).toThrow();
  });

  it("throws PaymentProviderNotConfiguredError when Breeze config is incomplete", async () => {
    vi.resetModules();
    vi.doMock("../../src/config/payment.config.js", () => ({
      paymentConfig: { breezeMerchantId: "", breezeEnvironment: "", breezeWebhookSecret: "", breezeShopUrl: "https://mypetmart.org" }
    }));
    vi.doMock("../../src/config/environment.config.js", () => ({ environmentConfig: { STOREFRONT_ORIGIN: "https://shop.test.example.com" } }));
    const mod = await import("../../src/models/PaymentModels/breeze.service.js");
    expect(() => mod.BreezeService.buildStartPaymentParams(order(), payment())).toThrow(/PAYMENT_PROVIDER_NOT_CONFIGURED|not configured/);
    vi.doUnmock("../../src/config/payment.config.js");
    vi.doUnmock("../../src/config/environment.config.js");
  });
});
