import type { FulfilmentStatus, OrderStatus, PaymentStatus } from "../../constants/database.constants.js";
import type { InlineAddressInput } from "../CheckoutModels/checkout.types.js";
import type { OrderShipmentSummaryJSON, ShipmentJSON } from "../ShipmentModels/shipment.types.js";

// Exactly one of the two must be present — enforced by createOrderSchema's
// Zod refine, not by this type. savedAddressId is customer-only (an
// authenticated, owned Address); shippingAddress is the same inline address
// contract Checkout Preview already accepts, usable by guest and customer.
export type CreateOrderInput = {
  savedAddressId?: number;
  shippingAddress?: InlineAddressInput;
  contactEmail?: string;
};

export type OrderItemJSON = {
  id: number;
  productId: number | null;
  variantId: number | null;
  productName: string;
  productSku: string;
  variantName: string | null;
  variantSku: string | null;
  productImage: string | null;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
};

export type OrderShippingAddressJSON = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  // Coordinates snapshotted at order creation time. Nullable because manual
  // (non-map-picked) addresses may have no coordinates.
  latitude: number | null;
  longitude: number | null;
};

export type OrderListItemJSON = {
  id: number;
  orderNumber: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  fulfilmentStatus: FulfilmentStatus;
  subtotal: string;
  shippingFee: string;
  total: string;
  currency: string;
  itemCount: number;
  placedAt: string;
};

// Customer-safe subset of the Payment record — deliberately its own type
// rather than a reuse of Admin's AdminOrderPaymentJSON, so a future
// admin-only field (e.g. raw provider metadata) never accidentally leaks
// onto this response just by widening the admin type. method/providerOrderId/
// paidAt/refundedAt are nullable because the underlying Payment columns are
// (a COD Payment, or a PayU attempt that never reached PayU, can genuinely
// have no method/txnid/paidAt yet) — never fabricated as non-null.
export type CustomerOrderPaymentJSON = {
  provider: string;
  method: string | null;
  status: PaymentStatus;
  providerOrderId: string | null;
  paidAt: string | null;
  refundedAt: string | null;
};

// null when the Order has no Refund rows at all (never fabricated).
// "processing" takes priority over "succeeded" (a customer with one
// completed and one still-pending refund should see the in-flight state,
// not a falsely-final "succeeded"); "failed" only when every refund on the
// Order failed. totalRefunded only sums succeeded amounts — a pending or
// failed refund hasn't moved any money yet.
export type CustomerOrderRefundSummaryJSON = {
  totalRefunded: string;
  status: "processing" | "succeeded" | "failed";
};

export type OrderDetailJSON = OrderListItemJSON & {
  contactEmail: string;
  shippingAddress: OrderShippingAddressJSON;
  items: OrderItemJSON[];
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
  shipment?: ShipmentJSON;
  payments: CustomerOrderPaymentJSON[];
  refundSummary: CustomerOrderRefundSummaryJSON | null;
};

// Additive-only wrapper around OrderDetailJSON used solely by Order Creation's
// response. guestAccessToken is the one-time raw recovery token — present
// only when the caller was a guest (customer creates never set it, keeping
// the customer response contract unchanged).
export type CreateOrderResultJSON = OrderDetailJSON & {
  guestAccessToken?: string;
};

// The guest-facing lookup response deliberately omits ship_latitude/ship_longitude
// (see storefront-order.controller.ts's handleGetGuestOrder) — a public,
// unauthenticated URL should not carry precise geolocation.
export type GuestOrderShippingAddressJSON = Omit<OrderShippingAddressJSON, "latitude" | "longitude">;

export type GuestOrderDetailJSON = Omit<OrderDetailJSON, "shippingAddress"> & {
  shippingAddress: GuestOrderShippingAddressJSON;
};

// Preview-only — never the full OrderItemJSON. Capped to 3 per order by the
// service (see listCustomerOrders), never client-controlled.
export type OrderProductPreviewJSON = {
  name: string;
  image: string | null;
};

export type CustomerOrderListItemJSON = OrderListItemJSON & {
  products: OrderProductPreviewJSON[];
  // null when the order has no shipment yet (never fabricated) — matches
  // the same "no shipment" meaning as OrderDetailJSON.shipment being absent.
  shipment: OrderShipmentSummaryJSON | null;
};

export type CustomerOrderListQuery = {
  page?: number;
  pageSize?: number;
  status?: OrderStatus;
  from?: string;
  to?: string;
  // Order number only — never searches customer PII (contrast with Admin's
  // search, which also matches against customer name/email).
  search?: string;
};

export type CustomerOrderListResult = {
  items: CustomerOrderListItemJSON[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

// ---- Admin ----

export type AdminOrderCustomerJSON = {
  id: number;
  name: string;
  email: string;
  phone: string | null;
};

export type AdminOrderListItemJSON = OrderListItemJSON & {
  // null for a guest Order — no fabricated placeholder customer row.
  customer: AdminOrderCustomerJSON | null;
  shipState: string;
  shipCity: string;
};

export type AdminOrderListQuery = {
  page?: number;
  pageSize?: number;
  search?: string;
  status?: OrderStatus;
  paymentStatus?: PaymentStatus;
  fulfilmentStatus?: FulfilmentStatus;
  productId?: number;
  state?: string;
  from?: string;
  to?: string;
  sortBy?: "placedAt" | "total";
  sortDir?: "ASC" | "DESC";
};

export type AdminOrderListResult = {
  items: AdminOrderListItemJSON[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type AdminOrderSummaryJSON = {
  total: number;
  pending: number;
  confirmed: number;
  processing: number;
  shipped: number;
  delivered: number;
  cancelled: number;
  returnRequested: number;
};

export type AdminOrderPaymentJSON = {
  id: number;
  provider: string;
  status: PaymentStatus;
  amount: string;
  currency: string;
  method: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  paidAt: string | null;
  failedAt: string | null;
  refundedAt: string | null;
  createdAt: string;
};

export type AdminOrderShipmentJSON = ShipmentJSON;

export type AdminOrderNoteJSON = {
  id: number;
  message: string;
  authorId: number;
  authorName: string;
  createdAt: string;
};

export type AdminOrderReturnJSON = {
  id: number;
  returnNumber: string;
  orderItemId: number;
  type: string;
  status: string;
  requestedAt: string;
};

export type AdminOrderDetailJSON = OrderDetailJSON & {
  // null for a guest Order — no fabricated placeholder customer row.
  customer: AdminOrderCustomerJSON | null;
  // Set only when a verified-successful payment could not confirm the Order
  // (stock ran out, or the Order was no longer confirmable) — see
  // PaymentFinalizationService / migration 034. Admin-only: never exposed on
  // the customer-facing OrderDetailJSON this type extends.
  commerceException: string | null;
  payments: AdminOrderPaymentJSON[];
  shipments: AdminOrderShipmentJSON[];
  notes: AdminOrderNoteJSON[];
  returns: AdminOrderReturnJSON[];
};

export type UpdateOrderStatusInput = {
  status: OrderStatus;
};

// Full replacement of the Order's own shipping snapshot — never the
// customer's saved Address book entry (see AddressModels; entirely
// unrelated table). No coordinates: this endpoint doesn't accept new
// lat/lng, and stale ones from before the edit are cleared rather than kept.
export type UpdateOrderShippingAddressInput = {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string | undefined;
  city: string;
  state: string;
  postalCode: string;
};

export type AddOrderNoteInput = {
  message: string;
};

export type BulkUpdateOrderStatusInput = {
  ids: number[];
  status: OrderStatus;
};

export type BulkUpdateOrderStatusResult = {
  updated: number;
  skipped: number;
};
