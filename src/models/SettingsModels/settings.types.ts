export type StoreProfile = {
  storeName: string;
  supportEmail: string;
  supportPhone: string;
  address: string;
};

// Admin-facing shape of the Global Pay Online Discount. discountValue is a
// decimal string in the unit the admin types: percent ("10.00") for
// "percentage", rupees ("100.00") for "fixed". Stored internally as basis
// points / paise (see CheckoutModels/online-payment-discount.ts).
export type PayOnlineDiscountSettingsJSON = {
  enabled: boolean;
  discountType: "percentage" | "fixed";
  discountValue: string;
  updatedAt: string | null;
};

export type IntegrationStatus = {
  provider: string | null;
  ready: boolean;
};

export type IntegrationsStatusJSON = {
  paymentGateway: IntegrationStatus;
  shippingPartner: IntegrationStatus;
  imageStorage: IntegrationStatus;
  analytics: IntegrationStatus;
};
