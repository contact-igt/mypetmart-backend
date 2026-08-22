import crypto from "node:crypto";

import { Op, QueryTypes, col, fn, type Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES, DEFAULT_COUNTRY_CODE, V1_FREE_SHIPPING_FEE, type OrderStatus, type UserRole } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { TokenService } from "../../services/auth/token.service.js";
import {
  Address,
  Cart,
  CartItem,
  Order,
  OrderItem,
  OrderNote,
  Payment,
  Product,
  ProductImage,
  ProductVariant,
  ReturnRequest,
  Shipment,
  ShipmentTrackingEvent,
  User
} from "../../database/tables/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";
import { formatMoney, formatPaiseAsMoney, parseMoneyToPaise } from "../../utils/product-money.js";
import type { CartIdentity } from "../CartModels/cart.types.js";
import type { InlineAddressInput } from "../CheckoutModels/checkout.types.js";
import { PaymentService } from "../PaymentModels/payment.service.js";
import { RefundService } from "../RefundModels/refund.service.js";
import { ShipmentService } from "../ShipmentModels/shipment.service.js";
import { CommerceNotifications } from "../../services/notification/commerce-notifications.service.js";
import type { ShipmentJSON } from "../ShipmentModels/shipment.types.js";
import { getValidNextOrderStatuses, isValidOrderStatusTransition } from "./order.constants.js";
import {
  GuestOrderNotFoundError,
  OrderAddressNotFoundError,
  OrderAddressRequiredError,
  OrderAlreadyPendingError,
  OrderCancelRequiresSuperAdminError,
  OrderCartEmptyError,
  OrderEmailRequiredError,
  OrderInsufficientStockError,
  OrderInvalidStatusTransitionError,
  OrderNotFoundError,
  OrderProductNotAvailableError,
  OrderVariantNotAvailableError
} from "./order.errors.js";
import type {
  AddOrderNoteInput,
  AdminOrderCustomerJSON,
  AdminOrderDetailJSON,
  AdminOrderListItemJSON,
  AdminOrderListQuery,
  AdminOrderListResult,
  AdminOrderNoteJSON,
  AdminOrderPaymentJSON,
  AdminOrderReturnJSON,
  AdminOrderShipmentJSON,
  AdminOrderSummaryJSON,
  BulkUpdateOrderStatusResult,
  CreateOrderInput,
  CreateOrderResultJSON,
  CustomerOrderListQuery,
  CustomerOrderListResult,
  GuestOrderDetailJSON,
  OrderDetailJSON,
  OrderItemJSON,
  OrderListItemJSON,
  OrderShippingAddressJSON
} from "./order.types.js";

// ---------------------------------------------------------------------------
// Internal helpers — deliberately NOT imported from CartModels. CartService's
// equivalent sellability check (loadSellableProductAndVariant) is private to
// that module and throws Cart-flavoured errors; re-exporting it risked
// touching an already-verified module and leaking CART_* error codes onto the
// Order API surface. This re-implements the same well-documented rule
// (variant stock for Variant Products, Product stock for Simple Products)
// locally, scoped to Order's own error vocabulary. See audit note in the
// final report for this trade-off.
// ---------------------------------------------------------------------------

type OrderableLine = {
  product: Product;
  variant: ProductVariant | null;
  unitPrice: string;
};

async function loadOrderableLine(cartItem: CartItem, transaction: Transaction): Promise<OrderableLine> {
  const product = await Product.findByPk(cartItem.product_id, { transaction, lock: transaction.LOCK.UPDATE });
  if (!product || product.status !== "active") {
    throw new OrderProductNotAvailableError(cartItem.product_id);
  }

  let variant: ProductVariant | null = null;
  let availableStock: number;
  let unitPrice: string;

  if (cartItem.product_variant_id !== null) {
    variant = await ProductVariant.findByPk(cartItem.product_variant_id, { transaction, lock: transaction.LOCK.UPDATE });
    if (!variant || variant.product_id !== product.id || !variant.active) {
      throw new OrderVariantNotAvailableError(cartItem.product_variant_id);
    }
    availableStock = variant.stock;
    unitPrice = variant.price;
  } else {
    availableStock = product.stock;
    unitPrice = product.price;
  }

  if (cartItem.quantity > availableStock) {
    throw new OrderInsufficientStockError(product.id, availableStock);
  }

  return { product, variant, unitPrice };
}

async function getPrimaryImageUrl(productId: number, transaction: Transaction): Promise<string | null> {
  const image = await ProductImage.findOne({
    where: { product_id: productId },
    order: [
      ["is_primary", "DESC"],
      ["sort_order", "ASC"],
      ["id", "ASC"]
    ],
    transaction
  });
  return image ? image.url : null;
}

// Deliberately NOT imported from CartModels — same rationale as
// loadOrderableLine above: CartService's active-Cart lookup is private and
// non-transactional/non-locking. Order Creation needs a FOR UPDATE lock on
// the same row while it reads/consumes CartItems, so this re-derives Cart
// identity server-side (never cartId/userId/guestToken from the request).
async function loadActiveCartForUpdate(identity: CartIdentity, transaction: Transaction): Promise<Cart | null> {
  const where = identity.type === "customer" ? { user_id: identity.userId, status: "active" as const } : { guest_token_hash: identity.tokenHash, status: "active" as const };
  return Cart.findOne({ where, transaction, lock: transaction.LOCK.UPDATE });
}

type ShippingSnapshot = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
};

function fromInlineAddress(input: InlineAddressInput): ShippingSnapshot {
  return {
    recipientName: input.recipientName,
    phone: input.phone,
    line1: input.line1,
    line2: input.line2 ?? null,
    city: input.city,
    state: input.state,
    postalCode: input.postalCode,
    country: input.country ?? DEFAULT_COUNTRY_CODE,
    latitude: input.latitude !== undefined ? input.latitude : null,
    longitude: input.longitude !== undefined ? input.longitude : null
  };
}

function fromSavedAddress(address: Address): ShippingSnapshot {
  return {
    recipientName: address.recipient_name,
    phone: address.phone,
    line1: address.line_1,
    line2: address.line_2,
    city: address.city,
    state: address.state,
    postalCode: address.postal_code,
    country: address.country,
    latitude: address.latitude !== null && address.latitude !== undefined ? parseFloat(address.latitude) : null,
    longitude: address.longitude !== null && address.longitude !== undefined ? parseFloat(address.longitude) : null
  };
}

/**
 * Resolves the shipping snapshot for Order Creation using the exact same
 * address contract Checkout Preview validates (see checkout.service.ts's
 * resolveShippingAddress) — this is the Checkout Preview <-> Order Creation
 * parity requirement. savedAddressId is customer-only and must be owned;
 * guests may only use shippingAddress. createOrderSchema's Zod refine already
 * guarantees exactly one of the two fields is present.
 */
async function resolveShippingSnapshot(identity: CartIdentity, input: CreateOrderInput, transaction: Transaction): Promise<ShippingSnapshot> {
  if (input.savedAddressId !== undefined) {
    if (identity.type !== "customer") {
      // Guests have no persistent address book — a guest-supplied
      // savedAddressId is never looked up, only rejected.
      throw new OrderAddressRequiredError();
    }
    const address = await Address.findOne({ where: { id: input.savedAddressId, user_id: identity.userId }, transaction });
    if (!address) {
      throw new OrderAddressNotFoundError(input.savedAddressId);
    }
    return fromSavedAddress(address);
  }

  if (input.shippingAddress) {
    return fromInlineAddress(input.shippingAddress);
  }

  throw new OrderAddressRequiredError();
}

// Same convention the guest Cart cookie already uses (resolve-cart-identity.middleware.ts):
// a 32-byte cryptographically secure random token, hex-encoded, hashed with
// the existing TokenService.hashToken (SHA-256). This is a *separate* token
// namespace from the guest Cart identity — a leaked Order recovery link can
// never be replayed to take over the guest's Cart.
function generateGuestAccessToken(): { rawToken: string; tokenHash: string } {
  const rawToken = crypto.randomBytes(32).toString("hex");
  return { rawToken, tokenHash: TokenService.hashToken(rawToken) };
}

// The guest-facing lookup response strips shipping coordinates — a public,
// unauthenticated recovery link should not carry precise geolocation, unlike
// the authenticated customer/admin detail views.
function toGuestOrderDetailJSON(order: Order, items: OrderItem[], shipment: ShipmentJSON | null): GuestOrderDetailJSON {
  const detail = toOrderDetailJSON(order, items, shipment);
  const { latitude: _latitude, longitude: _longitude, ...shippingAddress } = detail.shippingAddress;
  return { ...detail, shippingAddress };
}

function toOrderItemJSON(item: OrderItem): OrderItemJSON {
  return {
    id: item.id,
    productId: item.product_id,
    variantId: item.product_variant_id,
    productName: item.product_name,
    productSku: item.product_sku,
    variantName: item.variant_name,
    variantSku: item.variant_sku,
    productImage: item.product_image,
    quantity: item.quantity,
    unitPrice: formatMoney(item.unit_price),
    lineTotal: formatMoney(item.line_total)
  };
}

function toShippingAddressJSON(order: Order): OrderShippingAddressJSON {
  return {
    recipientName: order.ship_recipient_name,
    phone: order.ship_phone,
    line1: order.ship_line_1,
    line2: order.ship_line_2,
    city: order.ship_city,
    state: order.ship_state,
    postalCode: order.ship_postal_code,
    country: order.ship_country,
    latitude: order.ship_latitude !== null && order.ship_latitude !== undefined ? parseFloat(order.ship_latitude) : null,
    longitude: order.ship_longitude !== null && order.ship_longitude !== undefined ? parseFloat(order.ship_longitude) : null
  };
}

function toOrderListItemJSON(order: Order, itemCount: number): OrderListItemJSON {
  return {
    id: order.id,
    orderNumber: order.order_number,
    status: order.status,
    paymentStatus: order.payment_status,
    fulfilmentStatus: order.fulfilment_status,
    subtotal: formatMoney(order.subtotal),
    shippingFee: formatMoney(order.shipping_fee),
    total: formatMoney(order.total),
    currency: order.currency,
    itemCount,
    placedAt: order.placed_at.toISOString()
  };
}

function toOrderDetailJSON(order: Order, items: OrderItem[], shipment: ShipmentJSON | null = null): OrderDetailJSON {
  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  return {
    ...toOrderListItemJSON(order, itemCount),
    contactEmail: order.contact_email ?? "",
    shippingAddress: toShippingAddressJSON(order),
    items: items.map(toOrderItemJSON),
    cancelledAt: order.cancelled_at ? order.cancelled_at.toISOString() : null,
    createdAt: order.created_at.toISOString(),
    updatedAt: order.updated_at.toISOString(),
    ...(shipment ? { shipment } : {})
  };
}

async function getItemCountsByOrderId(orderIds: number[]): Promise<Map<number, number>> {
  if (orderIds.length === 0) {
    return new Map();
  }
  const rows = await OrderItem.findAll({
    attributes: ["order_id", [fn("SUM", col("quantity")), "itemCount"]],
    where: { order_id: { [Op.in]: orderIds } },
    group: ["order_id"],
    raw: true
  });
  const map = new Map<number, number>();
  for (const row of rows as unknown as { order_id: number; itemCount: string }[]) {
    map.set(row.order_id, Number(row.itemCount));
  }
  return map;
}

/**
 * Reconciles an existing "pending" Order's most recent Payment with PayU
 * BEFORE createOrder decides whether that Order still blocks a new one.
 * Deliberately runs outside any transaction (a PayU network call must never
 * happen inside an open DB transaction — same rule PaymentService follows)
 * and BEFORE createOrder's own transaction opens. Closes the gap where a
 * customer/guest could be stuck unable to place a new Order because an old
 * one still looks "pending" locally even though PayU actually captured
 * payment for it — this is exactly the scenario reconcilePendingAttempt
 * exists to catch, just triggered from the "place a new Order" entry point
 * instead of the payment ones. A reconciliation failure (network/provider
 * issue) is swallowed by reconcilePendingAttempt itself; createOrder simply
 * proceeds with whatever the last-known local state is, same as before this
 * existed.
 */
async function reconcileExistingPendingOrderPayment(identity: CartIdentity): Promise<void> {
  const where = identity.type === "customer" ? { user_id: identity.userId, status: "pending" as const } : { guest_identity_hash: identity.tokenHash, status: "pending" as const };
  const pendingOrder = await Order.findOne({ where });
  if (!pendingOrder) {
    return;
  }

  const payment = await Payment.findOne({ where: { order_id: pendingOrder.id, status: "pending" }, order: [["id", "DESC"]] });
  if (!payment) {
    return;
  }

  await PaymentService.reconcilePendingAttempt(payment);
}

export const OrderService = {
  /**
   * Creates a pending Order from the caller's current active Cart — customer
   * or guest. Cart identity is always re-derived server-side from
   * CartIdentity (never cartId/userId/guestToken on the request body).
   *
   * V1 locked rules (see final report for the full rationale): Order is
   * created BEFORE payment (status=pending/payment_status=pending/
   * fulfilment_status=unfulfilled); stock is validated but NOT decremented or
   * reserved; the Cart is left completely untouched; shipping_fee is a fixed
   * "0.00" and total==subtotal (no tax/discount in V1).
   *
   * Address: exactly one of a customer-owned savedAddressId or an inline
   * shippingAddress (the same contract Checkout Preview validates) — see
   * resolveShippingSnapshot. A guest may only use shippingAddress.
   *
   * Idempotency: an authenticated customer may have at most one `pending`
   * Order at a time. This is enforced by locking the parent User row first
   * (the same serialization primitive CartService/AddressService already
   * use) and then checking for an existing pending Order inside that same
   * lock. Two concurrent create requests from the same customer therefore
   * genuinely serialize — the second one to acquire the lock will see the
   * first's committed pending Order and reject with ORDER_ALREADY_PENDING
   * instead of creating a duplicate. This required no schema change.
   *
   * Guest identity has no User row to lock, so guest idempotency instead
   * locks the guest's own Cart row (the same row-locking primitive, applied
   * to the guest's equivalent parent row) and keys the pending-Order lookup
   * off `guest_identity_hash` — the same guest_token_hash Cart already uses.
   * A repeated/retried guest create request never creates a second Order:
   * it re-issues a fresh guest recovery token against the existing pending
   * Order instead, since a guest (unlike a customer) has no session to fall
   * back on if the original response never arrived.
   */
  async createOrder(identity: CartIdentity, input: CreateOrderInput): Promise<CreateOrderResultJSON> {
    await reconcileExistingPendingOrderPayment(identity);

    // Set only on the genuinely-new-Order path below (never the "reissue a
    // guest access token for an already-existing pending Order" early
    // return) — read after the transaction commits to fire ORDER_PLACED
    // exactly once per real Order, never on a reissue.
    const captured: { newlyCreatedOrder: { id: number; rawGuestToken: string | undefined } | null } = { newlyCreatedOrder: null };

    const result = await sequelize.transaction(async (t) => {
      let cart: Cart | null = null;
      let contactEmail: string;

      if (identity.type === "customer") {
        const user = await User.findByPk(identity.userId, { transaction: t, lock: t.LOCK.UPDATE });
        contactEmail = user!.email;

        const existingPending = await Order.findOne({
          where: { user_id: identity.userId, status: "pending" },
          transaction: t
        });
        if (existingPending) {
          throw new OrderAlreadyPendingError(existingPending.id, existingPending.order_number);
        }
      } else {
        if (!input.contactEmail) {
          throw new OrderEmailRequiredError();
        }
        contactEmail = input.contactEmail;

        // Lock first (if a Cart exists) so two concurrent guest create
        // requests genuinely serialize on this row before either can
        // check-then-create — mirroring the customer User-row lock above.
        cart = await loadActiveCartForUpdate(identity, t);

        const existingPending = await Order.findOne({
          where: { guest_identity_hash: identity.tokenHash, status: "pending" },
          transaction: t
        });
        if (existingPending) {
          const { rawToken, tokenHash } = generateGuestAccessToken();
          existingPending.guest_access_token_hash = tokenHash;
          await existingPending.save({ transaction: t });

          const items = await OrderItem.findAll({
            where: { order_id: existingPending.id },
            order: [["id", "ASC"]],
            transaction: t
          });
          return { ...toOrderDetailJSON(existingPending, items), guestAccessToken: rawToken };
        }
        // No existing pending Order — fall through to address resolution
        // first, preserving the original error precedence (an invalid/missing
        // address is reported before an empty Cart) for both guest and
        // customer. Cart emptiness is (re-)checked below either way.
      }

      const shipping = await resolveShippingSnapshot(identity, input, t);

      if (!cart) {
        cart = await loadActiveCartForUpdate(identity, t);
      }
      if (!cart) {
        throw new OrderCartEmptyError();
      }

      const cartItems = await CartItem.findAll({
        where: { cart_id: cart.id },
        order: [["id", "ASC"]],
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (cartItems.length === 0) {
        throw new OrderCartEmptyError();
      }

      type LineSnapshot = {
        productId: number;
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

      const lines: LineSnapshot[] = [];
      let subtotalPaise = 0;

      for (const item of cartItems) {
        const { product, variant, unitPrice } = await loadOrderableLine(item, t);
        const linePaise = parseMoneyToPaise(unitPrice) * item.quantity;
        subtotalPaise += linePaise;
        const productImage = await getPrimaryImageUrl(product.id, t);

        lines.push({
          productId: product.id,
          variantId: variant ? variant.id : null,
          productName: product.name,
          productSku: product.sku,
          variantName: variant ? variant.name : null,
          variantSku: variant ? variant.sku : null,
          productImage,
          quantity: item.quantity,
          unitPrice: formatMoney(unitPrice),
          lineTotal: formatPaiseAsMoney(linePaise)
        });
      }

      // V1 locked business rules: free shipping is an explicit business rule
      // (not an accidental placeholder — see V1_FREE_SHIPPING_FEE), and there
      // is no tax or discount/coupon module. total is computed as
      // subtotal + shippingFee so the formula stays correct once a future
      // logistics/shipping-rate integration replaces V1_FREE_SHIPPING_FEE
      // with a non-zero, per-order amount.
      const shippingFee = V1_FREE_SHIPPING_FEE;
      const shippingFeePaise = parseMoneyToPaise(shippingFee);
      const subtotal = formatPaiseAsMoney(subtotalPaise);
      const total = formatPaiseAsMoney(subtotalPaise + shippingFeePaise);

      const orderId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.orders, t);
      const orderNumber = buildBusinessReference("order", orderId);
      const guestAccess = identity.type === "guest" ? generateGuestAccessToken() : null;

      const order = await Order.create(
        {
          id: orderId,
          order_number: orderNumber,
          user_id: identity.type === "customer" ? identity.userId : null,
          guest_identity_hash: identity.type === "guest" ? identity.tokenHash : null,
          guest_access_token_hash: guestAccess ? guestAccess.tokenHash : null,
          // The exact Cart this Order was created from — see migration 033.
          // Payment finalization uses this instead of re-deriving "the
          // caller's current active Cart", which could resolve to a Cart
          // whose contents changed after this Order was created.
          cart_id: cart.id,
          status: "pending",
          payment_status: "pending",
          fulfilment_status: "unfulfilled",
          subtotal,
          shipping_fee: shippingFee,
          total,
          currency: "INR",
          contact_email: contactEmail,
          ship_recipient_name: shipping.recipientName,
          ship_phone: shipping.phone,
          ship_line_1: shipping.line1,
          ship_line_2: shipping.line2,
          ship_city: shipping.city,
          ship_state: shipping.state,
          ship_postal_code: shipping.postalCode,
          ship_country: shipping.country,
          // Snapshot coordinates at creation time — for a saved Address this stays
          // immutable even if the customer edits the source Address later.
          ship_latitude: shipping.latitude !== null ? String(shipping.latitude) : null,
          ship_longitude: shipping.longitude !== null ? String(shipping.longitude) : null
        },
        { transaction: t }
      );

      const itemIds = await IdSequenceService.allocateIdRange(DATABASE_TABLE_NAMES.orderItems, lines.length, t);

      const orderItems: OrderItem[] = [];
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index]!;
        const createdItem = await OrderItem.create(
          {
            id: itemIds[index]!,
            order_id: order.id,
            product_id: line.productId,
            product_variant_id: line.variantId,
            product_name: line.productName,
            product_sku: line.productSku,
            variant_name: line.variantName,
            variant_sku: line.variantSku,
            product_image: line.productImage,
            quantity: line.quantity,
            unit_price: line.unitPrice,
            line_total: line.lineTotal
          },
          { transaction: t }
        );
        orderItems.push(createdItem);
      }

      // Intentionally no Cart mutation and no Product/ProductVariant stock
      // mutation here — both are locked V1 business rules deferred to
      // verified payment finalization. This Order creation step only ever
      // performs a read-locked stock CHECK (loadOrderableLine above); it
      // never reserves and never decrements. The sole write path for stock,
      // Payment, Order and Cart state on a real payment outcome is
      // PaymentFinalizationService.processVerifiedPaymentResult
      // (PaymentModels/payment-finalization.service.ts) — see that file and
      // docs/mypetmart-architecture/payu-inventory-contract.md for the full
      // atomic transaction and the paid-but-out-of-stock exception handling.

      captured.newlyCreatedOrder = { id: order.id, rawGuestToken: guestAccess?.rawToken };

      const detail = toOrderDetailJSON(order, orderItems);
      return guestAccess ? { ...detail, guestAccessToken: guestAccess.rawToken } : detail;
    });

    if (captured.newlyCreatedOrder) {
      await CommerceNotifications.orderPlaced(captured.newlyCreatedOrder.id, captured.newlyCreatedOrder.rawGuestToken);
    }

    return result;
  },

  /**
   * Guest Order recovery — the only way a guest can ever retrieve an Order
   * they placed, since GET /storefront/orders/:orderId is customer-only.
   * Looked up strictly by the hash of the opaque recovery token (never a
   * numeric Order ID, never the guest Cart token); `user_id: null` is a
   * belt-and-suspenders check alongside the fact that a customer Order's
   * guest_access_token_hash is always NULL and can never match any hash.
   */
  async getGuestOrder(rawToken: string): Promise<GuestOrderDetailJSON> {
    const tokenHash = TokenService.hashToken(rawToken);
    const order = await Order.findOne({ where: { guest_access_token_hash: tokenHash, user_id: null } });
    if (!order) {
      throw new GuestOrderNotFoundError();
    }
    const [items, shipment] = await Promise.all([
      OrderItem.findAll({ where: { order_id: order.id }, order: [["id", "ASC"]] }),
      ShipmentService.getForOrder(order.id)
    ]);
    return toGuestOrderDetailJSON(order, items, shipment);
  },

  async listCustomerOrders(userId: number, query: CustomerOrderListQuery): Promise<CustomerOrderListResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const { rows, count } = await Order.findAndCountAll({
      where: { user_id: userId },
      order: [
        ["placed_at", "DESC"],
        ["id", "DESC"]
      ],
      limit: pageSize,
      offset
    });

    const counts = await getItemCountsByOrderId(rows.map((row) => row.id));

    return {
      items: rows.map((row) => toOrderListItemJSON(row, counts.get(row.id) ?? 0)),
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize)
    };
  },

  async getCustomerOrder(userId: number, orderId: number): Promise<OrderDetailJSON> {
    const order = await Order.findOne({ where: { id: orderId, user_id: userId } });
    if (!order) {
      throw new OrderNotFoundError(orderId);
    }
    const [items, shipment] = await Promise.all([
      OrderItem.findAll({ where: { order_id: order.id }, order: [["id", "ASC"]] }),
      ShipmentService.getForOrder(order.id)
    ]);
    return toOrderDetailJSON(order, items, shipment);
  }
};

// ---------------------------------------------------------------------------
// Admin
// ---------------------------------------------------------------------------

const ADMIN_SORT_COLUMN: Record<NonNullable<AdminOrderListQuery["sortBy"]>, string> = {
  placedAt: "placed_at",
  total: "total"
};

function toAdminCustomerJSON(user: User): AdminOrderCustomerJSON {
  return { id: user.id, name: user.name, email: user.email, phone: user.phone };
}

function toAdminOrderListItemJSON(order: Order, itemCount: number): AdminOrderListItemJSON {
  return {
    ...toOrderListItemJSON(order, itemCount),
    // null for a guest Order (user_id is NULL) — never a fabricated customer row.
    customer: order.user ? toAdminCustomerJSON(order.user) : null,
    shipState: order.ship_state,
    shipCity: order.ship_city
  };
}

function toAdminOrderPaymentJSON(payment: Payment): AdminOrderPaymentJSON {
  return {
    id: payment.id,
    provider: payment.provider,
    status: payment.status,
    amount: formatMoney(payment.amount),
    currency: payment.currency,
    method: payment.method,
    providerOrderId: payment.provider_order_id,
    providerPaymentId: payment.provider_payment_id,
    paidAt: payment.paid_at ? payment.paid_at.toISOString() : null,
    failedAt: payment.failed_at ? payment.failed_at.toISOString() : null,
    refundedAt: payment.refunded_at ? payment.refunded_at.toISOString() : null,
    createdAt: payment.created_at.toISOString()
  };
}

function toAdminOrderShipmentJSON(shipment: Shipment): AdminOrderShipmentJSON {
  return ShipmentService.toJSON(shipment);
}

function toAdminOrderNoteJSON(note: OrderNote): AdminOrderNoteJSON {
  return {
    id: note.id,
    message: note.message,
    authorId: note.admin_id,
    authorName: note.author ? note.author.name : "",
    createdAt: note.created_at.toISOString()
  };
}

function toAdminOrderReturnJSON(returnRequest: ReturnRequest): AdminOrderReturnJSON {
  return {
    id: returnRequest.id,
    returnNumber: returnRequest.return_number,
    orderItemId: returnRequest.order_item_id,
    type: returnRequest.type,
    status: returnRequest.status,
    requestedAt: returnRequest.requested_at.toISOString()
  };
}

async function resolveSearchUserIds(search: string, transaction?: Transaction): Promise<number[]> {
  const pattern = `%${search}%`;
  const users = await User.findAll({
    where: {
      role: "customer",
      [Op.or]: [{ name: { [Op.like]: pattern } }, { email: { [Op.like]: pattern } }, { phone: { [Op.like]: pattern } }]
    },
    attributes: ["id"],
    ...(transaction ? { transaction } : {})
  });
  return users.map((user) => user.id);
}

async function resolveProductOrderIds(productId: number): Promise<number[]> {
  const rows = await sequelize.query<{ order_id: number }>(
    "SELECT DISTINCT `order_id` FROM `order_items` WHERE `product_id` = ?",
    { replacements: [productId], type: QueryTypes.SELECT }
  );
  return rows.map((row) => row.order_id);
}

async function loadAdminOrderDetail(orderId: number, transaction?: Transaction): Promise<AdminOrderDetailJSON> {
  const order = await Order.findByPk(orderId, {
    include: [
      { model: User, as: "user" },
      { model: OrderItem, as: "items" },
      { model: Payment, as: "payments" },
      { model: Shipment, as: "shipments", include: [{ model: ShipmentTrackingEvent, as: "trackingEvents" }] },
      { model: OrderNote, as: "notes", include: [{ model: User, as: "author" }] },
      { model: ReturnRequest, as: "returns" }
    ],
    order: [
      [{ model: OrderItem, as: "items" }, "id", "ASC"],
      [{ model: OrderNote, as: "notes" }, "created_at", "DESC"]
    ],
    ...(transaction ? { transaction } : {})
  });
  if (!order) {
    throw new OrderNotFoundError(orderId);
  }

  const items = order.items ?? [];
  const normalShipment = (order.shipments ?? []).find((shipment) => shipment.source_type === "order") ?? null;
  const base = toOrderDetailJSON(order, items, normalShipment ? ShipmentService.toJSON(normalShipment) : null);

  return {
    ...base,
    // null for a guest Order (user_id is NULL) — never a fabricated customer row.
    customer: order.user ? toAdminCustomerJSON(order.user) : null,
    commerceException: order.commerce_exception,
    payments: (order.payments ?? []).map(toAdminOrderPaymentJSON),
    shipments: (order.shipments ?? []).map(toAdminOrderShipmentJSON),
    notes: (order.notes ?? []).map(toAdminOrderNoteJSON),
    returns: (order.returns ?? []).map(toAdminOrderReturnJSON)
  };
}

/**
 * Restores stock for every line of a paid Order that is being cancelled —
 * the counterpart to PaymentFinalizationService's stock decrement on
 * confirmation. Locks Product/Variant rows in the same deterministic
 * (product_id, product_variant_id) order that decrement uses, to avoid
 * cross-transaction deadlocks when two Orders touch the same product line.
 * A product or variant deleted since the Order was placed is left alone
 * (paranoid: false so a soft-deleted row is still found and restored —
 * matches ReplacementModels/replacement.service.ts's lockInventory
 * precedent); a hard-missing row has nothing left to restore against and is
 * silently skipped rather than blocking the cancellation itself.
 */
async function restoreStockForCancelledOrder(orderId: number, transaction: Transaction): Promise<void> {
  const orderItems = await OrderItem.findAll({ where: { order_id: orderId }, transaction });
  const sortedItems = [...orderItems].sort((a, b) => {
    const productDelta = (a.product_id ?? 0) - (b.product_id ?? 0);
    if (productDelta !== 0) return productDelta;
    return (a.product_variant_id ?? 0) - (b.product_variant_id ?? 0);
  });

  for (const item of sortedItems) {
    if (item.product_id === null) continue;
    const product = await Product.findByPk(item.product_id, { transaction, lock: transaction.LOCK.UPDATE, paranoid: false });
    if (!product) continue;

    if (item.product_variant_id !== null) {
      const variant = await ProductVariant.findByPk(item.product_variant_id, { transaction, lock: transaction.LOCK.UPDATE, paranoid: false });
      if (!variant) continue;
      variant.stock += item.quantity;
      await variant.save({ transaction });
    } else {
      product.stock += item.quantity;
      await product.save({ transaction });
    }
  }
}

export const AdminOrderService = {
  async getSummary(): Promise<AdminOrderSummaryJSON> {
    const rows = (await Order.findAll({
      attributes: ["status", [fn("COUNT", col("id")), "count"]],
      group: ["status"],
      raw: true
    })) as unknown as { status: OrderStatus; count: string }[];

    const counts: Record<OrderStatus, number> = {
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
      return_requested: 0
    };
    let total = 0;
    for (const row of rows) {
      const count = Number(row.count);
      counts[row.status] = count;
      total += count;
    }

    return {
      total,
      pending: counts.pending,
      confirmed: counts.confirmed,
      processing: counts.processing,
      shipped: counts.shipped,
      delivered: counts.delivered,
      cancelled: counts.cancelled,
      returnRequested: counts.return_requested
    };
  },

  async listOrders(query: AdminOrderListQuery): Promise<AdminOrderListResult> {
    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const offset = (page - 1) * pageSize;

    const where: Record<string | symbol, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.paymentStatus) where.payment_status = query.paymentStatus;
    if (query.fulfilmentStatus) where.fulfilment_status = query.fulfilmentStatus;
    if (query.state) where.ship_state = query.state;
    if (query.from || query.to) {
      const range: Record<symbol, Date> = {};
      if (query.from) range[Op.gte] = new Date(query.from);
      if (query.to) range[Op.lte] = new Date(query.to);
      where.placed_at = range;
    }

    if (query.search) {
      const matchedUserIds = await resolveSearchUserIds(query.search);
      where[Op.or as unknown as string] = [
        { order_number: { [Op.like]: `%${query.search}%` } },
        ...(matchedUserIds.length > 0 ? [{ user_id: { [Op.in]: matchedUserIds } }] : [])
      ];
    }

    if (query.productId) {
      const matchedOrderIds = await resolveProductOrderIds(query.productId);
      where.id = { [Op.in]: matchedOrderIds.length > 0 ? matchedOrderIds : [-1] };
    }

    const sortColumn = ADMIN_SORT_COLUMN[query.sortBy ?? "placedAt"];
    const sortDir = query.sortDir ?? "DESC";

    const { rows, count } = await Order.findAndCountAll({
      where,
      include: [{ model: User, as: "user", attributes: ["id", "name", "email", "phone"] }],
      order: [
        [sortColumn, sortDir],
        ["id", sortDir]
      ],
      limit: pageSize,
      offset
    });

    const counts = await getItemCountsByOrderId(rows.map((row) => row.id));

    return {
      items: rows.map((row) => toAdminOrderListItemJSON(row, counts.get(row.id) ?? 0)),
      total: count,
      page,
      pageSize,
      totalPages: Math.ceil(count / pageSize)
    };
  },

  async getOrderDetail(orderId: number): Promise<AdminOrderDetailJSON> {
    return loadAdminOrderDetail(orderId);
  },

  async updateStatus(orderId: number, nextStatus: OrderStatus, admin: { id: number; role: UserRole }): Promise<AdminOrderDetailJSON> {
    const { detail, pendingRefundId } = await sequelize.transaction(async (t) => {
      const order = await Order.findByPk(orderId, { transaction: t, lock: t.LOCK.UPDATE });
      if (!order) {
        throw new OrderNotFoundError(orderId);
      }
      if (!isValidOrderStatusTransition(order.status, nextStatus)) {
        throw new OrderInvalidStatusTransitionError(order.status, nextStatus);
      }

      // Cancelling an Order that was never paid is a pure status change (no
      // money or stock ever moved for it) and stays open to any admin.
      // Cancelling a PAID Order now restores stock and triggers a real
      // refund — the same real-money action the Return flow already
      // restricts to super_admin (admin-refund.routes.ts) — so it gets the
      // same restriction here.
      const isPaidCancellation = nextStatus === "cancelled" && order.payment_status === "paid";
      if (isPaidCancellation && admin.role !== "super_admin") {
        throw new OrderCancelRequiresSuperAdminError(order.id);
      }

      order.status = nextStatus;
      if (nextStatus === "cancelled") {
        order.cancelled_at = new Date();
      }
      // fulfilment_status/shipment are still never touched here — those
      // remain independent state machines (V1 locked rule). payment_status
      // is likewise never hand-set directly; when isPaidCancellation is
      // true it instead moves later, through the same PayU-verified refund
      // finalization path the Return flow already uses.

      let pendingRefundId: number | null = null;
      if (isPaidCancellation) {
        await restoreStockForCancelledOrder(order.id, t);
        const refund = await RefundService.createPendingCancellationRefund(admin.id, order, t);
        pendingRefundId = refund.id;
      }

      await order.save({ transaction: t });

      // Read back within the SAME transaction — a separate un-transacted read
      // here would run on a different connection and could see the
      // pre-commit snapshot, returning stale data even though the write
      // itself succeeded.
      return { detail: await loadAdminOrderDetail(order.id, t), pendingRefundId };
    });

    // Post-commit notification dispatch — see payment-finalization.service.ts
    // for why this always happens after the transaction, never inside it.
    // Only these three target statuses have a customer email; the state
    // machine (order.constants.ts) makes each reachable at most once per
    // Order, and CommerceNotifications re-verifies order.status before
    // sending regardless.
    if (nextStatus === "processing") await CommerceNotifications.orderProcessing(orderId);
    else if (nextStatus === "shipped") await CommerceNotifications.orderShipped(orderId);
    else if (nextStatus === "delivered") await CommerceNotifications.orderDelivered(orderId);

    if (pendingRefundId === null) {
      return detail;
    }

    await CommerceNotifications.refundInitiated(pendingRefundId);

    // PayU call deliberately outside the transaction above — the Refund row
    // is already durably committed alongside the cancellation and stock
    // restore. Re-read after dispatch so the response reflects whatever the
    // dispatch could determine synchronously (usually "processing"; a
    // definitive "refunded" only lands once PayU's webhook/recheck confirms).
    await RefundService.dispatchRefund(pendingRefundId);
    return loadAdminOrderDetail(orderId);
  },

  async bulkUpdateStatus(ids: number[], nextStatus: OrderStatus, admin: { id: number; role: UserRole }): Promise<BulkUpdateOrderStatusResult> {
    const pendingRefundIds: number[] = [];
    const updatedOrderIds: number[] = [];

    const result = await sequelize.transaction(async (t) => {
      let updated = 0;
      let skipped = 0;
      const uniqueIds = Array.from(new Set(ids));

      for (const id of uniqueIds) {
        const order = await Order.findByPk(id, { transaction: t, lock: t.LOCK.UPDATE });
        if (!order || !isValidOrderStatusTransition(order.status, nextStatus)) {
          skipped += 1;
          continue;
        }

        const isPaidCancellation = nextStatus === "cancelled" && order.payment_status === "paid";
        if (isPaidCancellation && admin.role !== "super_admin") {
          // Skip rather than fail the whole batch — matches the existing
          // "skip invalid, keep processing the rest" bulk semantics above.
          skipped += 1;
          continue;
        }

        order.status = nextStatus;
        if (nextStatus === "cancelled") {
          order.cancelled_at = new Date();
        }

        if (isPaidCancellation) {
          await restoreStockForCancelledOrder(order.id, t);
          const refund = await RefundService.createPendingCancellationRefund(admin.id, order, t);
          pendingRefundIds.push(refund.id);
        }

        await order.save({ transaction: t });
        updated += 1;
        updatedOrderIds.push(order.id);
      }

      return { updated, skipped };
    });

    // Sequential, after the transaction has committed — same "commit first,
    // notify/call the provider after" rule as the single-order path above.
    if (nextStatus === "processing" || nextStatus === "shipped" || nextStatus === "delivered") {
      for (const orderId of updatedOrderIds) {
        if (nextStatus === "processing") await CommerceNotifications.orderProcessing(orderId);
        else if (nextStatus === "shipped") await CommerceNotifications.orderShipped(orderId);
        else await CommerceNotifications.orderDelivered(orderId);
      }
    }

    for (const refundId of pendingRefundIds) {
      await CommerceNotifications.refundInitiated(refundId);
      await RefundService.dispatchRefund(refundId);
    }

    return result;
  },

  async addNote(orderId: number, admin: { id: number; name: string }, input: AddOrderNoteInput): Promise<AdminOrderNoteJSON> {
    return sequelize.transaction(async (t) => {
      const order = await Order.findByPk(orderId, { transaction: t });
      if (!order) {
        throw new OrderNotFoundError(orderId);
      }

      const noteId = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.orderNotes, t);
      const note = await OrderNote.create(
        {
          id: noteId,
          order_id: order.id,
          admin_id: admin.id,
          message: input.message
        },
        { transaction: t }
      );

      return {
        id: note.id,
        message: note.message,
        authorId: admin.id,
        authorName: admin.name,
        createdAt: note.created_at.toISOString()
      };
    });
  }
};

export { getValidNextOrderStatuses };
