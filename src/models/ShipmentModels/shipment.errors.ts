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
  public constructor() { super("SHIPPING_PROVIDER_NOT_CONFIGURED", "iThink Logistics credentials, store ID, warehouse, return address, and origin pincode are not fully configured.", 503); }
}
export class ShipmentNotEligibleError extends ShipmentError {
  public constructor(message: string) { super("SHIPMENT_NOT_ELIGIBLE", message, 409); }
}
export class ShipmentPackageDataError extends ShipmentError {
  public constructor(message: string) { super("SHIPMENT_PACKAGE_DATA_INVALID", message, 422); }
}
export class ShipmentServiceabilityError extends ShipmentError {
  public constructor(paymentMode: "prepaid" | "cod" = "prepaid") {
    super("SHIPMENT_DESTINATION_UNSERVICEABLE", `No ${paymentMode === "cod" ? "Cash on Delivery" : "prepaid"} forward courier is currently serviceable for this destination.`, 422);
  }
}
export class ShipmentProviderError extends ShipmentError {
  public constructor(code: string, message: string, statusCode = 502) { super(code, message, statusCode); }
}
export class ShipmentActionNotAllowedError extends ShipmentError {
  public constructor(action: string, status: string) { super("SHIPMENT_ACTION_NOT_ALLOWED", `${action} is not allowed while the shipment is '${status}'.`, 409, { action, status }); }
}
// Pre-flight validation (customer/address/package data) — thrown BEFORE any
// iThink API call, so a shipment is never even attempted with data iThink
// would reject anyway. Collects every missing/invalid field into one
// message rather than failing on the first, per the "Cannot create
// shipment. Missing: X, Y" UX this is meant to replace piecemeal errors with.
export class ShipmentValidationError extends ShipmentError {
  public constructor(missing: string[]) { super("SHIPMENT_VALIDATION_FAILED", `Cannot create shipment. Missing: ${missing.join(", ")}.`, 422, { missing }); }
}
// Thrown when an admin-selected courier/service type (from a prior quote)
// no longer appears in a freshly re-run rate check at booking time — the
// quote is never trusted blindly (see ShipmentModels/shipment.service.ts's
// create()), so a stale or fabricated selection is rejected here rather
// than silently falling back to the cheapest courier.
export class ShipmentCourierSelectionInvalidError extends ShipmentError {
  public constructor() { super("SHIPMENT_COURIER_SELECTION_INVALID", "Selected courier is unavailable.", 422); }
}
// Storefront pre-purchase delivery check (Product Detail page) only — a
// technical/provider failure (iThink down, timed out, rejected the request,
// or returned garbage). The message is deliberately generic and carries no
// iThink error code, courier name, or raw provider text: a storefront
// visitor must never see provider internals, and "unable to check right now"
// must never be confused with "we don't deliver there" (a non-serviceable
// pincode is a normal 200 result, not this error).
export class DeliveryCheckUnavailableError extends ShipmentError {
  public constructor() { super("DELIVERY_CHECK_UNAVAILABLE", "Unable to check delivery right now. Please try again.", 503); }
}
