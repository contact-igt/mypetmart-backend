import { environmentConfig } from "./environment.config.js";

export const r2Config = Object.freeze({
  accountId: environmentConfig.R2_ACCOUNT_ID,
  accessKeyId: environmentConfig.R2_ACCESS_KEY_ID,
  secretAccessKeyConfigured: Boolean(environmentConfig.R2_SECRET_ACCESS_KEY),
  bucket: environmentConfig.R2_BUCKET,
  publicBaseUrl: environmentConfig.R2_PUBLIC_BASE_URL,
  ready:
    Boolean(environmentConfig.R2_ACCOUNT_ID) &&
    Boolean(environmentConfig.R2_ACCESS_KEY_ID) &&
    Boolean(environmentConfig.R2_SECRET_ACCESS_KEY) &&
    Boolean(environmentConfig.R2_BUCKET) &&
    Boolean(environmentConfig.R2_PUBLIC_BASE_URL)
});
