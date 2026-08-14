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
  storeSettings: "store_settings",
  authChallenges: "auth_challenges",
  passwordResetTokens: "password_reset_tokens",
  wishlists: "wishlists"
});

export const AUTH_CHALLENGE_PURPOSE_VALUES = ["email_verification", "password_reset"] as const;
export type AuthChallengePurpose = (typeof AUTH_CHALLENGE_PURPOSE_VALUES)[number];

export const USER_ROLE_VALUES = ["customer", "admin", "super_admin"] as const;
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

export const PAYMENT_STATUS_VALUES = ["pending", "paid", "failed", "refunded", "cancelled"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUS_VALUES)[number];

export const FULFILMENT_STATUS_VALUES = ["unfulfilled", "processing", "packed", "shipped", "delivered"] as const;
export type FulfilmentStatus = (typeof FULFILMENT_STATUS_VALUES)[number];

// Set only when verified-successful payment finalization could not confirm
// the Order (see PaymentFinalizationService) — PayU genuinely captured the
// money (payment_status stays "paid") but the Order must not be treated as
// normally confirmed/fulfillable until an operator manually resolves it
// (restock/refund/cancellation-reconciliation; all out of scope here).
// "inventory_unavailable": stock ran out between Order creation and
// finalization (the two-Orders-race-for-the-last-unit case).
// "order_not_confirmable": the Order's own status was no longer eligible for
// the pending -> confirmed transition when a verified success arrived (e.g.
// it was independently cancelled while a Payment attempt was still in
// flight at PayU) — a distinct reason from a stock shortage, so it is not
// mislabeled as one. NULL for every ordinary Order.
export const ORDER_COMMERCE_EXCEPTION_VALUES = ["inventory_unavailable", "order_not_confirmable"] as const;
export type OrderCommerceException = (typeof ORDER_COMMERCE_EXCEPTION_VALUES)[number];

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

// V1 locked business rule: MyPetMart ships every order free of charge until a
// real logistics/shipping-rate integration replaces this fixed amount. Order
// creation persists this value into orders.shipping_fee and folds it into
// orders.total; Checkout Preview echoes the same value so both endpoints
// agree on the payable amount before any provider (PayU) initiation exists.
// Future logistics/shipping-rate integration must replace this backend-owned
// calculation before PayU initiation uses non-zero shipping.
export const V1_FREE_SHIPPING_FEE = "0.00";