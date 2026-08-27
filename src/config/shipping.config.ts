import { environmentConfig } from "./environment.config.js";

const isProduction = environmentConfig.NODE_ENV === "production";
const defaultApiBaseUrl = isProduction ? "https://my.ithinklogistics.com" : "https://pre-alpha.ithinklogistics.com";
const defaultTrackingBaseUrl = isProduction ? "https://api.ithinklogistics.com" : "https://pre-alpha.ithinklogistics.com";

export const shippingConfig = Object.freeze({
  provider: environmentConfig.SHIPPING_PROVIDER ?? "ithink",
  accessToken: environmentConfig.ITHINK_ACCESS_TOKEN,
  secretKey: environmentConfig.ITHINK_SECRET_KEY,
  apiBaseUrl: (environmentConfig.ITHINK_API_BASE_URL ?? defaultApiBaseUrl).replace(/\/$/u, ""),
  trackingBaseUrl: (environmentConfig.ITHINK_TRACKING_BASE_URL ?? defaultTrackingBaseUrl).replace(/\/$/u, ""),
  storeId: environmentConfig.ITHINK_STORE_ID,
  pickupAddressId: environmentConfig.ITHINK_PICKUP_ADDRESS_ID,
  returnAddressId: environmentConfig.ITHINK_RETURN_ADDRESS_ID,
  originPincode: environmentConfig.ITHINK_ORIGIN_PINCODE,
  timeoutMs: environmentConfig.ITHINK_TIMEOUT_MS,
  ready: Boolean(
    environmentConfig.ITHINK_ACCESS_TOKEN &&
      environmentConfig.ITHINK_SECRET_KEY &&
      environmentConfig.ITHINK_STORE_ID &&
      environmentConfig.ITHINK_PICKUP_ADDRESS_ID &&
      environmentConfig.ITHINK_RETURN_ADDRESS_ID &&
      environmentConfig.ITHINK_ORIGIN_PINCODE
  )
});
