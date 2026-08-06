import { environmentConfig } from "./environment.config.js";

export const paymentConfig = Object.freeze({
  provider: environmentConfig.PAYMENT_PROVIDER,
  keyIdConfigured: Boolean(environmentConfig.PAYMENT_KEY_ID),
  keySecretConfigured: Boolean(environmentConfig.PAYMENT_KEY_SECRET),
  webhookSecretConfigured: Boolean(environmentConfig.PAYMENT_WEBHOOK_SECRET),
  ready:
    Boolean(environmentConfig.PAYMENT_PROVIDER) &&
    Boolean(environmentConfig.PAYMENT_KEY_ID) &&
    Boolean(environmentConfig.PAYMENT_KEY_SECRET) &&
    Boolean(environmentConfig.PAYMENT_WEBHOOK_SECRET)
});
