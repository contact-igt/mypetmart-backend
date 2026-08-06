import { environmentConfig } from "./environment.config.js";

export const shippingConfig = Object.freeze({
  provider: environmentConfig.SHIPPING_PROVIDER,
  apiKeyConfigured: Boolean(environmentConfig.SHIPPING_API_KEY),
  webhookSecretConfigured: Boolean(environmentConfig.SHIPPING_WEBHOOK_SECRET),
  ready:
    Boolean(environmentConfig.SHIPPING_PROVIDER) &&
    Boolean(environmentConfig.SHIPPING_API_KEY) &&
    Boolean(environmentConfig.SHIPPING_WEBHOOK_SECRET)
});
