export const DATABASE_TABLE_NAMES = Object.freeze({
  users: "users",
  authSessions: "auth_sessions",
  addresses: "addresses",
  categories: "categories",
  products: "products",
  productVariants: "product_variants",
  productImages: "product_images",
  productFeatures: "product_features",
  productSpecifications: "product_specifications",
  productMediaAssignments: "product_media_assignments",
  productContentBlocks: "product_content_blocks",
  productReviews: "product_reviews",
  productFaqs: "product_faqs",
  carts: "carts",
  cartItems: "cart_items",
  orders: "orders",
  orderItems: "order_items",
  orderNotes: "order_notes",
  payments: "payments",
  shipments: "shipments",
  shipmentTrackingEvents: "shipment_tracking_events",
  returnRequests: "return_requests",
  returnNotes: "return_notes",
  refunds: "refunds",
  replacements: "replacements",
  contactEnquiries: "contact_enquiries",
  storeSettings: "store_settings",
  orderDocuments: "order_documents",
  returnShipments: "return_shipments",
  returnShipmentTrackingEvents: "return_shipment_tracking_events",
  authChallenges: "auth_challenges",
  passwordResetTokens: "password_reset_tokens",
  wishlists: "wishlists",
  mediaAssets: "media_assets",
  newsletterSubscribers: "newsletter_subscribers",
  notificationLog: "notification_log"
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

// V1 media library types: image (existing) and video (MP4 only — see
// object-storage.service.ts's MEDIA_LIBRARY_VIDEO_TYPES). Derived server-side
// from the verified upload's MIME type at MediaAssetService.completeUpload,
// never trusted from client input.
export const MEDIA_ASSET_TYPE_VALUES = ["image", "video"] as const;
export type MediaAssetType = (typeof MEDIA_ASSET_TYPE_VALUES)[number];

// V1 Product<->MediaAsset assignment roles (Phase B). Enhanced Content
// (future ProductContentBlock) deliberately does not reuse this enum — see
// product_media_assignments schema comment.
export const PRODUCT_MEDIA_ROLE_VALUES = ["product_video", "testimonial_video"] as const;
export type ProductMediaRole = (typeof PRODUCT_MEDIA_ROLE_VALUES)[number];

// Enhanced Product Content (Phase — ProductContentBlock). A tightly
// constrained, code-controlled layout set — never free CSS/column widths
// from the DB. See product_content_blocks schema comment.
export const PRODUCT_CONTENT_LAYOUT_VALUES = ["media_left", "media_right", "media_full"] as const;
export type ProductContentLayout = (typeof PRODUCT_CONTENT_LAYOUT_VALUES)[number];

// Written Product Reviews (V1). Moderation-gated: only "approved" Reviews are
// ever shown to the Storefront or counted in the rating summary — see
// review.service.ts. Reused product statuses ("pending"/"approved"/"rejected")
// deliberately match ReturnRequest's REVIEW_STATUS-shaped values so the
// existing Admin StatusBadge tone map already covers these for free.
export const REVIEW_STATUS_VALUES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUS_VALUES)[number];

// Distinguishes a genuine customer-submitted Review (verified_purchase tied
// to a real delivered OrderItem) from a manually-entered Admin Review (no
// User/OrderItem, verified_purchase always false — see review.service.ts's
// createAdminReview).
export const REVIEW_SOURCE_VALUES = ["customer", "admin"] as const;
export type ReviewSource = (typeof REVIEW_SOURCE_VALUES)[number];

export const CART_STATUS_VALUES = ["active", "ordered", "abandoned"] as const;
export type CartStatus = (typeof CART_STATUS_VALUES)[number];

export const ORDER_STATUS_VALUES = ["pending", "confirmed", "processing", "shipped", "delivered", "cancelled", "return_requested"] as const;
export type OrderStatus = (typeof ORDER_STATUS_VALUES)[number];

// "partially_refunded" added for the Returns + Refunds feature: a Payment
// stays "paid" (never overwritten) as one or more successful, item-level
// Refund records are created against it; this value distinguishes "some but
// not all of this payment has been refunded" from "refunded" (the full
// captured amount has now been returned) — see RefundFinalizationService.
export const PAYMENT_STATUS_VALUES = ["pending", "paid", "failed", "refunded", "cancelled", "partially_refunded"] as const;
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

export const SHIPMENT_SOURCE_TYPE_VALUES = ["order", "replacement"] as const;
export type ShipmentSourceType = (typeof SHIPMENT_SOURCE_TYPE_VALUES)[number];

export const SHIPMENT_STATUS_VALUES = [
  "pending",
  "provider_status_unknown",
  "created",
  "awb_assigned",
  "pickup_pending",
  "picked_up",
  "in_transit",
  "out_for_delivery",
  "delivered",
  "delivery_exception",
  "ndr",
  "rto_initiated",
  "rto_in_transit",
  "rto_delivered",
  "cancelled",
  "failed"
] as const;
export type ShipmentStatus = (typeof SHIPMENT_STATUS_VALUES)[number];

export const RETURN_TYPE_VALUES = ["return", "replacement"] as const;
export type ReturnType = (typeof RETURN_TYPE_VALUES)[number];

export const RETURN_STATUS_VALUES = ["requested", "approved", "rejected", "resolved"] as const;
export type ReturnStatus = (typeof RETURN_STATUS_VALUES)[number];

// Refund financial state is deliberately separate from ReturnRequest.status
// (the return *process* state) — a Return can be "approved" while its linked
// Refund cycles through pending/processing before landing on succeeded/failed.
// See RefundFinalizationService: pending -> succeeded|failed only, terminal
// once reached (mirrors TERMINAL_PAYMENT_STATUSES' monotonicity guarantee).
export const REFUND_STATUS_VALUES = ["pending", "processing", "succeeded", "failed"] as const;
export type RefundStatus = (typeof REFUND_STATUS_VALUES)[number];

// Shipping/AWB automation does not exist yet. Replacement therefore tracks
// only inventory allocation and the manual operational completion boundary.
export const REPLACEMENT_STATUS_VALUES = ["stock_unavailable", "processing", "completed"] as const;
export type ReplacementStatus = (typeof REPLACEMENT_STATUS_VALUES)[number];

// Reverse (customer -> warehouse) courier lifecycle for an approved
// ReturnRequest — Phase F.1. Deliberately a separate, coarser vocabulary
// from SHIPMENT_STATUS_VALUES (no rto_*/ndr/provider_status_unknown split):
// a reverse pickup has no RTO-of-an-RTO concept, and any courier-reported
// exception (undelivered pickup, lost, damaged) normalizes to "failed" —
// see ReturnShipmentModels/return-shipment.service.ts's own status-mapping
// comment for the full reasoning.
export const RETURN_SHIPMENT_STATUS_VALUES = ["pending", "approved", "pickup_scheduled", "picked_up", "in_transit", "delivered", "failed", "cancelled"] as const;
export type ReturnShipmentStatus = (typeof RETURN_SHIPMENT_STATUS_VALUES)[number];

export const CONTACT_ENQUIRY_STATUS_VALUES = ["new", "in_progress", "resolved", "closed"] as const;
export type ContactEnquiryStatus = (typeof CONTACT_ENQUIRY_STATUS_VALUES)[number];

// V1: capture + double opt-in only (subscribe -> verification email -> confirm
// link -> unsubscribe link). No campaign-sending/worker states — "pending" is
// re-used on every fresh subscribe attempt, including a resubscribe after
// "unsubscribed", so there is only ever one verification flow to reason about.
export const NEWSLETTER_SUBSCRIBER_STATUS_VALUES = ["pending", "subscribed", "unsubscribed"] as const;
export type NewsletterSubscriberStatus = (typeof NEWSLETTER_SUBSCRIBER_STATUS_VALUES)[number];

// One row per (event_type, entity_type, entity_id) — see NOTIFICATION_EVENT_TYPE_VALUES
// below for what entity_id means per event. The UNIQUE constraint on that
// triple (see schema-definition.ts) is the durable, crash-safe idempotency
// guarantee for transactional emails: a claim row is inserted BEFORE the
// email is sent, so a replayed webhook/retry that races a prior successful
// send always loses the INSERT (UniqueConstraintError) and skips sending,
// even across process restarts. This deliberately does not use an in-memory
// Set anywhere. See services/notification/notification.service.ts.
export const NOTIFICATION_EVENT_TYPE_VALUES = [
  "ORDER_PLACED",
  "PAYMENT_SUCCESSFUL",
  "PAYMENT_FAILED",
  "ORDER_PROCESSING",
  "ORDER_SHIPPED",
  "ORDER_OUT_FOR_DELIVERY",
  "ORDER_DELIVERED",
  "RETURN_REQUESTED",
  "RETURN_APPROVED",
  "RETURN_REJECTED",
  "REFUND_INITIATED",
  "REFUND_SUCCEEDED",
  "REFUND_FAILED",
  "REPLACEMENT_APPROVED",
  "REPLACEMENT_STOCK_UNAVAILABLE",
  "REPLACEMENT_SHIPPED",
  "REPLACEMENT_COMPLETED",
  // Shipment lifecycle events (Phase 1D.2) — SHIPMENT_CREATED fires once an
  // AWB is booked (ShipmentService.create()'s success path), distinct from
  // ORDER_SHIPPED which fires later once the courier's own tracking reports
  // pickup. SHIPMENT_DELIVERY_FAILED collapses both "ndr" and
  // "delivery_exception" Shipment statuses into one customer-facing event —
  // see CommerceNotifications.deliveryAttemptFailed's own doc comment.
  "SHIPMENT_CREATED",
  "SHIPMENT_RTO_INITIATED",
  "SHIPMENT_DELIVERY_FAILED",
  // Reverse (return) shipment lifecycle — Phase F.1. RETURN_PICKUP_CREATED
  // fires once iThink accepts the reverse booking (AWB assigned);
  // RETURN_PICKED_UP/RETURN_DELIVERED fire from the same tracking-sync
  // ingest path once the courier's own scans report those milestones.
  "RETURN_PICKUP_CREATED",
  "RETURN_PICKED_UP",
  "RETURN_DELIVERED"
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPE_VALUES)[number];

// What entity_id refers to for a given event_type — e.g. PAYMENT_SUCCESSFUL
// is keyed by entity_type "order" (dedup is per-Order: whichever Payment
// attempt first succeeds sends the one email for that Order), while
// PAYMENT_FAILED is keyed by "payment" (each distinct failed attempt is its
// own real, customer-meaningful event). See commerce-notifications.service.ts
// for the full per-event rationale.
export const NOTIFICATION_ENTITY_TYPE_VALUES = ["order", "payment", "return", "refund", "replacement", "shipment", "return_shipment"] as const;
export type NotificationEntityType = (typeof NOTIFICATION_ENTITY_TYPE_VALUES)[number];

export const NOTIFICATION_STATUS_VALUES = ["pending", "sent", "failed", "skipped"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUS_VALUES)[number];

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

// Phase E.2: a non-GST customer receipt only. "invoice" is deliberately not
// added here yet — a future GST-invoice phase adds it as a new ENUM value
// (the same additive-extension pattern already used for e.g.
// PAYMENT_STATUS_VALUES/NOTIFICATION_EVENT_TYPE_VALUES) once seller
// GSTIN/HSN/tax data actually exists, reusing this same order_documents
// table rather than a parallel one.
export const ORDER_DOCUMENT_TYPE_VALUES = ["receipt"] as const;
export type OrderDocumentType = (typeof ORDER_DOCUMENT_TYPE_VALUES)[number];
