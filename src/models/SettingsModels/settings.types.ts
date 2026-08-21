export type StoreProfile = {
  storeName: string;
  supportEmail: string;
  supportPhone: string;
  address: string;
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
