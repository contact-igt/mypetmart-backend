import { ApplicationError } from "../../utils/application-error.js";

export class ReturnShipmentError extends ApplicationError {
  public constructor(code: string, message: string, statusCode = 400, details?: unknown) {
    super({ statusCode, code, message, details, isOperational: true });
    this.name = "ReturnShipmentError";
  }
}

export class ReturnShipmentNotFoundError extends ReturnShipmentError {
  public constructor(id: number) { super("RETURN_SHIPMENT_NOT_FOUND", `Return shipment '${id}' was not found.`, 404); }
}
export class ReturnShipmentProviderNotConfiguredError extends ReturnShipmentError {
  public constructor() { super("SHIPPING_PROVIDER_NOT_CONFIGURED", "iThink Logistics credentials, store ID, warehouse, return address, and origin pincode are not fully configured.", 503); }
}
// The gate this closes: a reverse pickup only makes sense once the return
// itself is approved (see ReturnService.adminReviewReturn) — "requested" or
// "rejected" must never get a courier dispatched to the customer's door.
export class ReturnShipmentNotEligibleError extends ReturnShipmentError {
  public constructor(message: string) { super("RETURN_SHIPMENT_NOT_ELIGIBLE", message, 409); }
}
export class ReturnShipmentAlreadyExistsError extends ReturnShipmentError {
  public constructor(returnRequestId: number) { super("RETURN_SHIPMENT_ALREADY_EXISTS", `Return request '${returnRequestId}' already has a return shipment.`, 409, { returnRequestId }); }
}
export class ReturnShipmentPackageDataError extends ReturnShipmentError {
  public constructor(message: string) { super("RETURN_SHIPMENT_PACKAGE_DATA_INVALID", message, 422); }
}
export class ReturnShipmentServiceabilityError extends ReturnShipmentError {
  public constructor() { super("RETURN_SHIPMENT_DESTINATION_UNSERVICEABLE", "No reverse-pickup-capable courier is currently serviceable for this pickup address.", 422); }
}
// The admin picked a courier from a return-shipment quote that a fresh
// reverse rate check no longer offers (rates/serviceability moved between
// quote and booking, or a bogus carrier/serviceType pair). Never silently
// falls back to the automatic cheapest pick — mirrors ShipmentModels'
// ShipmentCourierSelectionInvalidError for the forward flow.
export class ReturnShipmentCourierSelectionInvalidError extends ReturnShipmentError {
  public constructor() { super("RETURN_SHIPMENT_COURIER_SELECTION_INVALID", "The selected reverse courier is no longer available. Re-check the options and try again.", 409); }
}
export class ReturnShipmentProviderError extends ReturnShipmentError {
  public constructor(code: string, message: string, statusCode = 502) { super(code, message, statusCode); }
}
export class ReturnShipmentActionNotAllowedError extends ReturnShipmentError {
  public constructor(action: string, status: string) { super("RETURN_SHIPMENT_ACTION_NOT_ALLOWED", `${action} is not allowed while the return shipment is '${status}'.`, 409, { action, status }); }
}
