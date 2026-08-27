import { ApplicationError } from "../../utils/application-error.js";

export class OrderError extends ApplicationError {
  public constructor(code: string, message: string, statusCode: number = 400, details?: unknown) {
    super({
      statusCode,
      code,
      message,
      details,
      isOperational: true
    });
    this.name = "OrderError";
  }
}

export class InvalidOrderIdError extends OrderError {
  public constructor() {
    super("INVALID_ORDER_ID", "Order ID must be a positive safe integer.", 400);
    this.name = "InvalidOrderIdError";
  }
}

export class OrderNotFoundError extends OrderError {
  public constructor(identifier: string | number) {
    super("ORDER_NOT_FOUND", `Order '${identifier}' was not found.`, 404);
    this.name = "OrderNotFoundError";
  }
}

export class OrderCartEmptyError extends OrderError {
  public constructor() {
    super("ORDER_CART_EMPTY", "Your cart is empty. Add items before placing an order.", 422);
    this.name = "OrderCartEmptyError";
  }
}

export class OrderAddressRequiredError extends OrderError {
  public constructor() {
    // Covers both "neither savedAddressId nor shippingAddress was supplied"
    // and "a guest supplied savedAddressId", which is unusable without a
    // customer identity to own it against.
    super("ORDER_ADDRESS_REQUIRED", "A shipping address is required to place an order.", 400);
    this.name = "OrderAddressRequiredError";
  }
}

export class OrderEmailRequiredError extends OrderError {
  public constructor() {
    super("ORDER_EMAIL_REQUIRED", "A contact email is required to place an order as a guest.", 400);
    this.name = "OrderEmailRequiredError";
  }
}

export class OrderAddressNotFoundError extends OrderError {
  public constructor(identifier: string | number) {
    super("ORDER_ADDRESS_NOT_FOUND", `Address '${identifier}' was not found.`, 404);
    this.name = "OrderAddressNotFoundError";
  }
}

// Idempotency guard (see order.service.ts): a customer may have at most one
// pending Order at a time. This is what prevents duplicate Orders from a
// double-click/retry without any schema change.
export class OrderAlreadyPendingError extends OrderError {
  public constructor(orderId: number, orderNumber: string) {
    super(
      "ORDER_ALREADY_PENDING",
      `Order '${orderNumber}' is already pending payment. Complete or cancel it before placing a new order.`,
      409,
      { orderId, orderNumber }
    );
    this.name = "OrderAlreadyPendingError";
  }
}

// Deliberately generic — never echoes the submitted token back, so an
// attacker probing the guest lookup route learns nothing about whether a
// token is malformed vs. simply unknown.
export class GuestOrderNotFoundError extends OrderError {
  public constructor() {
    super("GUEST_ORDER_NOT_FOUND", "No order was found for this recovery link.", 404);
    this.name = "GuestOrderNotFoundError";
  }
}

export class OrderProductNotAvailableError extends OrderError {
  public constructor(productId: number) {
    super("ORDER_PRODUCT_NOT_AVAILABLE", `Product '${productId}' is no longer available for purchase.`, 422, { productId });
    this.name = "OrderProductNotAvailableError";
  }
}

export class OrderVariantNotAvailableError extends OrderError {
  public constructor(variantId: number | null) {
    super("ORDER_VARIANT_NOT_AVAILABLE", `Variant '${String(variantId)}' is no longer available for purchase.`, 422, { variantId });
    this.name = "OrderVariantNotAvailableError";
  }
}

export class OrderInsufficientStockError extends OrderError {
  public constructor(productId: number, availableQuantity: number) {
    super(
      "ORDER_INSUFFICIENT_STOCK",
      `Only ${availableQuantity} unit(s) of product '${productId}' are currently available.`,
      422,
      { productId, availableQuantity }
    );
    this.name = "OrderInsufficientStockError";
  }
}

export class OrderInvalidStatusTransitionError extends OrderError {
  public constructor(current: string, next: string) {
    super("ORDER_INVALID_STATUS_TRANSITION", `Order cannot move from '${current}' to '${next}'.`, 422, { current, next });
    this.name = "OrderInvalidStatusTransitionError";
  }
}

// Cancelling an already-paid Order now triggers a real refund (see
// order.service.ts restoreStockForCancelledOrder / RefundService
// .createPendingCancellationRefund) — the same real-money guard already
// applied to Return-flow refund initiation (admin-refund.routes.ts requires
// super_admin) must also apply here. Cancelling an unpaid Order is unaffected
// and remains available to any admin.
export class OrderCancelRequiresSuperAdminError extends OrderError {
  public constructor(orderId: number) {
    super(
      "ORDER_CANCEL_REQUIRES_SUPER_ADMIN",
      `Order '${orderId}' has already been paid — cancelling it triggers a refund and requires a super admin.`,
      403,
      { orderId }
    );
    this.name = "OrderCancelRequiresSuperAdminError";
  }
}

// Editing the delivery address of a terminal Order (cancelled/delivered/a
// return already in progress) has no useful effect and risks confusing a
// completed fulfilment record — mirrors the same "terminal states are
// closed to further mutation" principle isValidOrderStatusTransition already
// enforces for order.status itself.
export class OrderShippingAddressNotEditableError extends OrderError {
  public constructor(orderId: number, status: string) {
    super(
      "ORDER_SHIPPING_ADDRESS_NOT_EDITABLE",
      `Order '${orderId}' shipping address cannot be edited while the order status is '${status}'.`,
      422,
      { orderId, status }
    );
    this.name = "OrderShippingAddressNotEditableError";
  }
}
