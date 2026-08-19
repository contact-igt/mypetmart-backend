import { ApplicationError } from "../../utils/application-error.js";

export class ShipmentError extends ApplicationError {
  public constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super({ statusCode, code, message, details, isOperational: true });
    this.name = "ShipmentError";
  }
}

export class ShipmentNotFoundError extends ShipmentError {
  public constructor(id: number) { super("SHIPMENT_NOT_FOUND", `Shipment '${id}' was not found.`, 404); }
}
export class ShipmentProviderNotConfiguredError extends ShipmentError {
  public constructor() { super("SHIPPING_PROVIDER_NOT_CONFIGURED", "iThink Logistics credentials, warehouse, return address, and origin pincode are not fully configured.", 503); }
}
export class ShipmentNotEligibleError extends ShipmentError {
  public constructor(message: string) { super("SHIPMENT_NOT_ELIGIBLE", message, 409); }
}
export class ShipmentPackageDataError extends ShipmentError {
  public constructor(message: string) { super("SHIPMENT_PACKAGE_DATA_INVALID", message, 422); }
}
export class ShipmentServiceabilityError extends ShipmentError {
  public constructor() { super("SHIPMENT_DESTINATION_UNSERVICEABLE", "No prepaid forward courier is currently serviceable for this destination.", 422); }
}
export class ShipmentProviderError extends ShipmentError {
  public constructor(code: string, message: string, statusCode = 502) { super(code, message, statusCode); }
}
export class ShipmentActionNotAllowedError extends ShipmentError {
  public constructor(action: string, status: string) { super("SHIPMENT_ACTION_NOT_ALLOWED", `${action} is not allowed while the shipment is '${status}'.`, 409, { action, status }); }
}
