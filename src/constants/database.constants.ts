export const DATABASE_TABLE_NAMES = Object.freeze({
  users: "users",
  authSessions: "auth_sessions",
  addresses: "addresses",
  categories: "categories",
  products: "products",
  productVariants: "product_variants",
  productImages: "product_images",
  carts: "carts",
  cartItems: "cart_items",
  orders: "orders",
  orderItems: "order_items",
  orderNotes: "order_notes",
  payments: "payments",
  shipments: "shipments",
  returnRequests: "return_requests",
  returnNotes: "return_notes",
  contactEnquiries: "contact_enquiries",
  storeSettings: "store_settings"
});

export const USER_ROLE_VALUES = ["customer", "admin"] as const;
export type UserRole = (typeof USER_ROLE_VALUES)[number];

export const USER_STATUS_VALUES = ["active", "disabled"] as const;
export type UserStatus = (typeof USER_STATUS_VALUES)[number];

export const SESSION_TYPE_VALUES = ["customer", "admin"] as const;
export type SessionType = (typeof SESSION_TYPE_VALUES)[number];

export const PET_TYPE_VALUES = ["dog", "cat", "all"] as const;
export type PetType = (typeof PET_TYPE_VALUES)[number];

export const PRODUCT_STATUS_VALUES = ["active", "draft", "archived"] as const;
export type ProductStatus = (typeof PRODUCT_STATUS_VALUES)[number];

export const CART_STATUS_VALUES = ["active", "ordered", "abandoned"] as const;
export type CartStatus = (typeof CART_STATUS_VALUES)[number];

export const ORDER_STATUS_VALUES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "return_requested"] as const;
export type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

export const PAYMENT_STATUS_VALUES = ["pending", "paid", "failed", "refunded"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

export const FULFILMENT_STATUS_VALUES = ["unfulfilled", "processing", "packed", "shipped", "delivered"] as const;
export type FulfilmentStatus = (typeof FULFILMENT_STATUS_VALUES)[number];

export const SHIPPING_METHOD_VALUES = ["standard", "express"] as const;
export type ShippingMethod = (typeof SHIPPING_METHOD_VALUES)[number];

export const SHIPMENT_STATUS_VALUES = ["pending", "processing", "shipped", "delivered", "failed", "cancelled"] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS_VALUES)[number];

export const RETURN_TYPE_VALUES = ["return", "replacement"] as const;
export type ReturnType = (typeof RETURN_TYPE_VALUES)[number];

export const RETURN_STATUS_VALUES = ["requested", "approved", "rejected", "resolved"] as const;
export type ReturnStatus = (typeof RETURN_STATUS_VALUES)[number];

export const CONTACT_ENQUIRY_STATUS_VALUES = ["new", "in_progress", "resolved", "closed"] as const;
export type ContactEnquiryStatus = (typeof CONTACT_ENQUIRY_STATUS_VALUES)[number];

export const DEFAULT_COUNTRY_CODE = "IN";
export const DEFAULT_CURRENCY_CODE = "INR";
export const UUID_COLUMN_LENGTH = 36;
export const MONEY_PRECISION = 10;
export const MONEY_SCALE = 2;