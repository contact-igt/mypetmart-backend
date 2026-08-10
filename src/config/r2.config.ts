import { environmentConfig } from "./environment.config.js";

export const r2Config = Object.freeze({
  accountId: environmentConfig.R2_ACCOUNT_ID,
  endpoint: environmentConfig.R2_ACCOUNT_ID
    ? `https://${environmentConfig.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
    : undefined,
  accessKeyId: environmentConfig.R2_ACCESS_KEY_ID,
  secretAccessKeyConfigured: Boolean(environmentConfig.R2_SECRET_ACCESS_KEY),
  bucket: environmentConfig.R2_BUCKET,
  publicBaseUrl: environmentConfig.R2_PUBLIC_BASE_URL,
  uploadIntentSecret: environmentConfig.R2_UPLOAD_INTENT_SECRET,
  uploadUrlExpirySeconds: environmentConfig.R2_UPLOAD_URL_EXPIRY_SECONDS,
  maxImageSizeBytes: environmentConfig.R2_MAX_IMAGE_SIZE_BYTES,
  orphanGraceHours: environmentConfig.R2_ORPHAN_GRACE_HOURS,
  ready:
    Boolean(environmentConfig.R2_ACCOUNT_ID) &&
    Boolean(environmentConfig.R2_ACCESS_KEY_ID) &&
    Boolean(environmentConfig.R2_SECRET_ACCESS_KEY) &&
    Boolean(environmentConfig.R2_BUCKET) &&
    Boolean(environmentConfig.R2_PUBLIC_BASE_URL) &&
    Boolean(environmentConfig.R2_UPLOAD_INTENT_SECRET)
});
