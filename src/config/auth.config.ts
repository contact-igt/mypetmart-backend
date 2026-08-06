import { environmentConfig } from "./environment.config.js";

export const authConfig = Object.freeze({
  accessSecretConfigured: Boolean(environmentConfig.JWT_ACCESS_SECRET),
  refreshSecretConfigured: Boolean(environmentConfig.JWT_REFRESH_SECRET),
  accessTokenExpiresIn: environmentConfig.JWT_ACCESS_EXPIRES_IN,
  refreshTokenExpiresIn: environmentConfig.JWT_REFRESH_EXPIRES_IN
});
