import { environmentConfig } from "./environment.config.js";

export const authConfig = Object.freeze({
  accessSecret: environmentConfig.JWT_ACCESS_SECRET,
  refreshSecret: environmentConfig.JWT_REFRESH_SECRET,
  accessTokenExpiresIn: environmentConfig.JWT_ACCESS_EXPIRES_IN,
  refreshTokenExpiresIn: environmentConfig.JWT_REFRESH_EXPIRES_IN,
  issuer: environmentConfig.JWT_ISSUER,
  customerAudience: environmentConfig.JWT_CUSTOMER_AUDIENCE,
  adminAudience: environmentConfig.JWT_ADMIN_AUDIENCE,
  customerRefreshCookieName: environmentConfig.CUSTOMER_REFRESH_COOKIE_NAME,
  adminRefreshCookieName: environmentConfig.ADMIN_REFRESH_COOKIE_NAME,
  rateLimitWindowMs: environmentConfig.AUTH_RATE_LIMIT_WINDOW_MS,
  rateLimitMax: environmentConfig.AUTH_RATE_LIMIT_MAX
});
