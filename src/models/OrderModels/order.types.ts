import type { FulfilmentStatus, OrderStatus, PaymentStatus } from "../../constants/database.constants.js";
import type { InlineAddressInput } from "../CheckoutModels/checkout.types.js";

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

export type OrderDetailJSON = OrderListItemJSON & {
  contactEmail: string;
  shippingAddress: OrderShippingAddressJSON;
  items: OrderItemJSON[];
  cancelledAt: string | null;
  createdAt: string;
  updatedAt: string;
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

export type CustomerOrderListQuery = {
  page?: number;
  pageSize?: number;
};

export type CustomerOrderListResult = {
  items: OrderListItemJSON[];
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

export type AdminOrderShipmentJSON = {
  id: number;
  method: string;
  carrier: string | null;
  trackingNumber: string | null;
  status: string;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
};

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
