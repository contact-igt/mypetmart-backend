import { environmentConfig } from "./environment.config.js";

export const shipmentConfig = Object.freeze({
  numberPrefix: environmentConfig.SHIPMENT_NUMBER_PREFIX
});
