import { environmentConfig } from "./environment.config.js";

export const cartConfig = Object.freeze({
  guestCookieName: environmentConfig.CART_GUEST_COOKIE_NAME
});
