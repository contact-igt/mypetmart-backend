import { UniqueConstraintError, type Transaction } from "sequelize";

import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { Cart, CartItem, Coupon, Product, ProductImage, ProductVariant, User } from "../../database/tables/index.js";
import type { Order } from "../../database/tables/OrderTable/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { CouponPricingService } from "../CouponModels/coupon.service.js";
import { normalizeCouponCode } from "../CouponModels/coupon.validation.js";
import type { CouponPricingLine } from "../CouponModels/coupon.types.js";
import { formatImageDTO } from "../ProductModels/product.service.js";
import { ProductNotFoundError, ProductVariantNotFoundError } from "../ProductModels/product.errors.js";
import { MAX_CART_ITEM_QUANTITY } from "./cart.constants.js";
import {
  CartCouponEmptyCartError,
  CartItemNotFoundError,
  CartInsufficientStockError,
  CartProductNotAvailableError,
  CartQuantityLimitExceededError,
  CartVariantMismatchError,
  CartVariantNotAllowedError,
  CartVariantNotAvailableError,
  CartVariantRequiredError
} from "./cart.errors.js";
import type {
  AddCartItemInput,
  ApplyCartCouponInput,
  CartAvailabilityReason,
  CartCouponJSON,
  CartIdentity,
  CartItemImageJSON,
  CartItemJSON,
  CartJSON,
  CartMergeReport,
  CartMergeResult
} from "./cart.types.js";

function paiseToMoneyString(paise: number): string {
  const rupees = Math.floor(paise / 100);
  const cents = paise % 100;
  return `${rupees}.${String(cents).padStart(2, "0")}`;
}

function moneyToPaise(amount: string): number {
  const [rupees, cents = "0"] = amount.split(".");
  return Number(rupees) * 100 + Number(cents.padEnd(2, "0").slice(0, 2));
}

async function findOrCreateCustomerCart(userId: number, transaction: Transaction): Promise<Cart> {
  // Locking the parent user row serializes concurrent "get-or-create my active cart"
  // calls for the same customer, since carts has no unique (user_id, status) constraint.
  await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });

  const existing = await Cart.findOne({
    where: { user_id: userId, status: "active" },
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (existing) {
    return existing;
  }

  const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.carts, transaction);
  return Cart.create({ id, user_id: userId, status: "active" }, { transaction });
}

async function findOrCreateGuestCart(tokenHash: string, transaction: Transaction): Promise<Cart> {
  const existing = await Cart.findOne({
    where: { guest_token_hash: tokenHash },
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (existing) {
    if (existing.status !== "active") {
      // A new shopping session on a reused guest cart starts empty — including
      // no coupon carried over from the order that finalized this cart.
      await CartItem.destroy({ where: { cart_id: existing.id }, transaction });
      existing.status = "active";
      existing.coupon_id = null;
      await existing.save({ transaction });
    }
    return existing;
  }

  const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.carts, transaction);
  try {
    return await Cart.create({ id, guest_token_hash: tokenHash, status: "active" }, { transaction });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      const raced = await Cart.findOne({
        where: { guest_token_hash: tokenHash },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (raced) {
        if (raced.status !== "active") {
          await CartItem.destroy({ where: { cart_id: raced.id }, transaction });
          raced.status = "active";
          raced.coupon_id = null;
          await raced.save({ transaction });
        }
        return raced;
      }
    }
    throw error;
  }
}

async function findActiveCart(identity: CartIdentity, transaction?: Transaction): Promise<Cart | null> {
  const where = identity.type === "customer" ? { user_id: identity.userId, status: "active" as const } : { guest_token_hash: identity.tokenHash, status: "active" as const };
  return Cart.findOne({ where, ...(transaction ? { transaction } : {}) });
}

async function findOrCreateCart(identity: CartIdentity, transaction: Transaction): Promise<Cart> {
  return identity.type === "customer" ? findOrCreateCustomerCart(identity.userId, transaction) : findOrCreateGuestCart(identity.tokenHash, transaction);
}

function identityUserId(identity: CartIdentity): number | null {
  return identity.type === "customer" ? identity.userId : null;
}

async function getPrimaryImageDTO(productId: number, transaction?: Transaction): Promise<CartItemImageJSON | null> {
  const image = await ProductImage.findOne({
    where: { product_id: productId },
    order: [
      ["is_primary", "DESC"],
      ["sort_order", "ASC"],
      ["id", "ASC"]
    ],
    ...(transaction ? { transaction } : {})
  });
  if (!image) {
    return null;
  }
  const dto = formatImageDTO(image);
  return { url: dto.url, alt: dto.alt };
}

function buildCartItemDTO(item: CartItem, product: Product, variant: ProductVariant | null, image: CartItemImageJSON | null): CartItemJSON {
  const productLive = product.deleted_at === null && product.status === "active";

  let unitPrice: string;
  let compareAtPrice: string | null;
  let available: boolean;
  let availabilityReason: CartAvailabilityReason | null;
  let availableQuantity: number;

  if (variant) {
    unitPrice = variant.price;
    compareAtPrice = variant.compare_at_price;
    const variantLive = variant.deleted_at === null && variant.active === true;

    if (!productLive) {
      available = false;
      availabilityReason = "PRODUCT_UNAVAILABLE";
      availableQuantity = 0;
    } else if (!variantLive) {
      available = false;
      availabilityReason = "VARIANT_UNAVAILABLE";
      availableQuantity = 0;
    } else if (variant.stock < item.quantity) {
      available = false;
      availabilityReason = "OUT_OF_STOCK";
      availableQuantity = variant.stock;
    } else {
      available = true;
      availabilityReason = null;
      availableQuantity = variant.stock;
    }
  } else {
    unitPrice = product.price;
    compareAtPrice = product.compare_at_price;

    if (!productLive) {
      available = false;
      availabilityReason = "PRODUCT_UNAVAILABLE";
      availableQuantity = 0;
    } else if (product.stock < item.quantity) {
      available = false;
      availabilityReason = "OUT_OF_STOCK";
      availableQuantity = product.stock;
    } else {
      available = true;
      availabilityReason = null;
      availableQuantity = product.stock;
    }
  }

  const subtotalPaise = moneyToPaise(unitPrice) * item.quantity;

  return {
    cartItemId: item.id,
    productId: product.id,
    categoryId: product.category_id,
    variantId: variant ? variant.id : null,
    productName: product.name,
    productSlug: product.slug,
    productType: product.has_variants ? "variant" : "simple",
    sku: variant ? variant.sku : product.sku,
    variantName: variant ? variant.name : null,
    image,
    price: paiseToMoneyString(moneyToPaise(unitPrice)),
    compareAtPrice: compareAtPrice ? paiseToMoneyString(moneyToPaise(compareAtPrice)) : null,
    quantity: item.quantity,
    subtotal: paiseToMoneyString(subtotalPaise),
    available,
    availabilityReason,
    availableQuantity
  };
}

// Re-evaluates the Cart's applied coupon live, every time the Cart is
// rendered — never trusts a stored discount amount (there isn't one; only
// coupon_id is ever persisted). `eligible: false` deliberately does not
// clear cart.coupon_id: a coupon that's temporarily ineligible (e.g. the
// cart total dropped below its minimum) should resume applying automatically
// once the cart becomes eligible again, without the customer re-applying it.
async function buildCartCouponJSON(couponId: number, lines: CouponPricingLine[], identityUserId: number | null, transaction?: Transaction): Promise<CartCouponJSON> {
  const coupon = await Coupon.findByPk(couponId, transaction ? { transaction } : undefined);
  if (!coupon) {
    // Coupons are archived, never hard-deleted (see coupon.errors.js) — this
    // should be unreachable, but a missing reference renders as "no
    // discount" rather than throwing from a read path.
    return null;
  }

  const evaluation = await CouponPricingService.evaluateCoupon({ code: coupon.code, lines, identity: { userId: identityUserId } });
  if (evaluation.ok) {
    return {
      code: evaluation.codeSnapshot,
      eligible: true,
      discountAmount: paiseToMoneyString(evaluation.discountAmountPaise),
      eligibleMerchandiseSubtotal: paiseToMoneyString(evaluation.eligibleMerchandisePaise),
      message: null
    };
  }
  return {
    code: coupon.code,
    eligible: false,
    discountAmount: "0.00",
    eligibleMerchandiseSubtotal: "0.00",
    message: evaluation.message
  };
}

async function buildCartDTO(cart: Cart | null, identityUserId: number | null, transaction?: Transaction): Promise<CartJSON> {
  if (!cart) {
    return { id: null, status: "active", itemCount: 0, subtotal: "0.00", items: [], coupon: null };
  }

  const rows = await CartItem.findAll({
    where: { cart_id: cart.id },
    order: [["id", "ASC"]],
    ...(transaction ? { transaction } : {})
  });

  const items: CartItemJSON[] = [];
  const pricingLines: CouponPricingLine[] = [];
  for (const item of rows) {
    // paranoid:false so a Product/Variant soft-deleted after being added still renders
    // (as unavailable) instead of silently disappearing from the cart.
    const product = await Product.findByPk(item.product_id, { paranoid: false, ...(transaction ? { transaction } : {}) });
    if (!product) {
      // Impossible under the FK (RESTRICT) unless data was corrupted out-of-band.
      throw new Error(`Cart item ${item.id} references missing product ${item.product_id}.`);
    }
    const variant = item.product_variant_id
      ? await ProductVariant.findByPk(item.product_variant_id, { paranoid: false, ...(transaction ? { transaction } : {}) })
      : null;
    const image = await getPrimaryImageDTO(product.id, transaction);

    items.push(buildCartItemDTO(item, product, variant, image));
    pricingLines.push({
      productId: product.id,
      categoryId: product.category_id,
      unitPricePaise: moneyToPaise(variant ? variant.price : product.price),
      quantity: item.quantity
    });
  }

  const itemCount = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotalPaise = items.reduce((sum, item) => sum + moneyToPaise(item.subtotal), 0);
  const coupon = cart.coupon_id !== null ? await buildCartCouponJSON(cart.coupon_id, pricingLines, identityUserId, transaction) : null;

  return {
    id: cart.id,
    status: cart.status,
    itemCount,
    subtotal: paiseToMoneyString(subtotalPaise),
    items,
    coupon
  };
}

async function loadSellableProductAndVariant(
  productId: number,
  variantId: number | undefined,
  transaction: Transaction
): Promise<{ product: Product; variant: ProductVariant | null; availableStock: number }> {
  const product = await Product.findByPk(productId, { transaction, lock: transaction.LOCK.UPDATE });
  if (!product) {
    throw new ProductNotFoundError(productId);
  }
  if (product.status !== "active") {
    throw new CartProductNotAvailableError();
  }

  if (product.has_variants) {
    if (variantId === undefined) {
      throw new CartVariantRequiredError();
    }
    const variant = await ProductVariant.findByPk(variantId, { transaction, lock: transaction.LOCK.UPDATE });
    if (!variant) {
      throw new ProductVariantNotFoundError(variantId);
    }
    if (variant.product_id !== product.id) {
      throw new CartVariantMismatchError();
    }
    if (!variant.active) {
      throw new CartVariantNotAvailableError();
    }
    return { product, variant, availableStock: variant.stock };
  }

  if (variantId !== undefined) {
    throw new CartVariantNotAllowedError();
  }
  return { product, variant: null, availableStock: product.stock };
}

export const CartService = {
  /**
   * Finalizes the exact Cart that produced a now-verified-paid Order,
   * flipping it active -> ordered. Called only from
   * PaymentFinalizationService, inside its own locked transaction — never
   * opens a transaction of its own. Idempotent: a Cart that is missing,
   * already `ordered`, or `abandoned` is left untouched, so replaying this
   * on a duplicate/replayed webhook is always safe.
   *
   * Prefers `order.cart_id` (the exact Cart row captured at Order creation
   * time — see migration 033). Only Orders created before that column
   * existed (`cart_id === null`) fall back to the legacy "caller's current
   * active Cart" lookup, which is not guaranteed to be the same Cart that
   * produced the Order if its contents changed afterward — acceptable only
   * as a one-time migration bridge, not the steady-state behavior.
   */
  async finalizeCartForOrder(order: Order, transaction: Transaction): Promise<void> {
    const cart =
      order.cart_id !== null
        ? await Cart.findByPk(order.cart_id, { transaction, lock: transaction.LOCK.UPDATE })
        : await Cart.findOne({
            where: order.user_id !== null ? { user_id: order.user_id, status: "active" as const } : { guest_token_hash: order.guest_identity_hash, status: "active" as const },
            transaction,
            lock: transaction.LOCK.UPDATE
          });

    if (cart && cart.status === "active") {
      cart.status = "ordered";
      await cart.save({ transaction });
    }
  },

  async getCart(identity: CartIdentity): Promise<CartJSON> {
    const cart = await findActiveCart(identity);
    return buildCartDTO(cart, identityUserId(identity));
  },

  async addCartItem(identity: CartIdentity, input: AddCartItemInput): Promise<CartJSON> {
    return sequelize.transaction(async (t) => {
      const cart = await findOrCreateCart(identity, t);
      const { product, variant, availableStock } = await loadSellableProductAndVariant(input.productId, input.variantId, t);
      const variantColumnValue = variant ? variant.id : null;

      let cartItem = await CartItem.findOne({
        where: { cart_id: cart.id, product_id: product.id, product_variant_id: variantColumnValue },
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      const unitPriceSnapshot = variant ? variant.price : product.price;

      if (!cartItem) {
        const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.cartItems, t);
        try {
          if (input.quantity > availableStock) {
            throw new CartInsufficientStockError(availableStock);
          }
          cartItem = await CartItem.create(
            {
              id,
              cart_id: cart.id,
              product_id: product.id,
              product_variant_id: variantColumnValue,
              quantity: input.quantity,
              unit_price_snapshot: unitPriceSnapshot
            },
            { transaction: t }
          );
          return buildCartDTO(cart, identityUserId(identity), t);
        } catch (error) {
          if (!(error instanceof UniqueConstraintError)) {
            throw error;
          }
          cartItem = await CartItem.findOne({
            where: { cart_id: cart.id, product_id: product.id, product_variant_id: variantColumnValue },
            transaction: t,
            lock: t.LOCK.UPDATE
          });
          if (!cartItem) {
            throw error;
          }
        }
      }

      const combinedQuantity = cartItem.quantity + input.quantity;
      if (combinedQuantity > MAX_CART_ITEM_QUANTITY) {
        throw new CartQuantityLimitExceededError(MAX_CART_ITEM_QUANTITY);
      }
      if (combinedQuantity > availableStock) {
        throw new CartInsufficientStockError(availableStock);
      }

      cartItem.quantity = combinedQuantity;
      cartItem.unit_price_snapshot = unitPriceSnapshot;
      await cartItem.save({ transaction: t });

      return buildCartDTO(cart, identityUserId(identity), t);
    });
  },

  async updateCartItemQuantity(identity: CartIdentity, cartItemId: number, quantity: number): Promise<CartJSON> {
    return sequelize.transaction(async (t) => {
      const cart = await findActiveCart(identity, t);
      if (!cart) {
        throw new CartItemNotFoundError(cartItemId);
      }

      const cartItem = await CartItem.findOne({
        where: { id: cartItemId, cart_id: cart.id },
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!cartItem) {
        throw new CartItemNotFoundError(cartItemId);
      }

      const { product, variant, availableStock } = await loadSellableProductAndVariant(
        cartItem.product_id,
        cartItem.product_variant_id ?? undefined,
        t
      );
      if (quantity > availableStock) {
        throw new CartInsufficientStockError(availableStock);
      }

      cartItem.quantity = quantity;
      cartItem.unit_price_snapshot = variant ? variant.price : product.price;
      await cartItem.save({ transaction: t });

      return buildCartDTO(cart, identityUserId(identity), t);
    });
  },

  async removeCartItem(identity: CartIdentity, cartItemId: number): Promise<CartJSON> {
    return sequelize.transaction(async (t) => {
      const cart = await findActiveCart(identity, t);
      if (!cart) {
        throw new CartItemNotFoundError(cartItemId);
      }

      const cartItem = await CartItem.findOne({
        where: { id: cartItemId, cart_id: cart.id },
        transaction: t,
        lock: t.LOCK.UPDATE
      });
      if (!cartItem) {
        throw new CartItemNotFoundError(cartItemId);
      }

      await cartItem.destroy({ transaction: t });
      return buildCartDTO(cart, identityUserId(identity), t);
    });
  },

  async clearCart(identity: CartIdentity): Promise<CartJSON> {
    return sequelize.transaction(async (t) => {
      const cart = await findActiveCart(identity, t);
      if (!cart) {
        return buildCartDTO(null, identityUserId(identity));
      }

      await CartItem.destroy({ where: { cart_id: cart.id }, transaction: t });
      return buildCartDTO(cart, identityUserId(identity), t);
    });
  },

  async applyCoupon(identity: CartIdentity, input: ApplyCartCouponInput): Promise<CartJSON> {
    return sequelize.transaction(async (t) => {
      const cart = await findOrCreateCart(identity, t);
      const code = normalizeCouponCode(input.code);

      const rows = await CartItem.findAll({ where: { cart_id: cart.id }, order: [["id", "ASC"]], transaction: t });
      if (rows.length === 0) {
        throw new CartCouponEmptyCartError();
      }

      const lines: CouponPricingLine[] = [];
      for (const item of rows) {
        const product = await Product.findByPk(item.product_id, { paranoid: false, transaction: t });
        if (!product) {
          throw new Error(`Cart item ${item.id} references missing product ${item.product_id}.`);
        }
        const variant = item.product_variant_id ? await ProductVariant.findByPk(item.product_variant_id, { paranoid: false, transaction: t }) : null;
        lines.push({
          productId: product.id,
          categoryId: product.category_id,
          unitPricePaise: moneyToPaise(variant ? variant.price : product.price),
          quantity: item.quantity
        });
      }

      // Throws CouponNotApplicableError (422) if the code doesn't validate
      // right now — an Apply request never silently no-ops on an invalid
      // code. Only the coupon_id REFERENCE is ever persisted here — no
      // discount amount is stored. Re-applying the same already-applied
      // code is idempotent (overwrites coupon_id with the same value) and
      // never creates a redemption — redemptions only ever come from Order
      // creation (see CouponPricingService.reserveCouponForOrder).
      const evaluation = await CouponPricingService.assertCouponApplicable({ code, lines, identity: { userId: identityUserId(identity) } });

      cart.coupon_id = evaluation.couponId;
      await cart.save({ transaction: t });

      return buildCartDTO(cart, identityUserId(identity), t);
    });
  },

  async removeCoupon(identity: CartIdentity): Promise<CartJSON> {
    return sequelize.transaction(async (t) => {
      const cart = await findActiveCart(identity, t);
      if (!cart) {
        return buildCartDTO(null, identityUserId(identity));
      }

      if (cart.coupon_id !== null) {
        cart.coupon_id = null;
        await cart.save({ transaction: t });
      }

      return buildCartDTO(cart, identityUserId(identity), t);
    });
  },

  // Coupon merge policy (Module 2 — explicitly decided, not pre-specified by
  // the audit): a guest cart's applied coupon (guestCart.coupon_id) is
  // deliberately NEVER copied onto the customer cart here. The customer
  // cart's own existing coupon_id (if any) is left completely untouched.
  // Rationale: a coupon a guest applied was only ever validated under
  // guest rules (evaluateCoupon already refuses any per-customer-limit or
  // first-order-only coupon for a guest), so carrying it over adds no value
  // and risks surprising the now-authenticated customer with a discount they
  // never explicitly chose under their own identity. Dropping it is safe and
  // cheap to recover from: applying a coupon is idempotent and the customer
  // can simply re-apply it (via POST /cart/coupon) if it's still eligible.
  async mergeGuestCartIntoCustomerCart(userId: number, guestTokenHash: string | null): Promise<CartMergeResult> {
    return sequelize.transaction(async (t) => {
      const customerCart = await findOrCreateCustomerCart(userId, t);
      const mergeReport: CartMergeReport = { mergedItems: [], adjustedItems: [], skippedItems: [] };

      const guestCart = guestTokenHash
        ? await Cart.findOne({
            where: { guest_token_hash: guestTokenHash, status: "active" },
            transaction: t,
            lock: t.LOCK.UPDATE
          })
        : null;

      if (!guestCart) {
        return { cart: await buildCartDTO(customerCart, userId, t), mergeReport };
      }

      const guestItems = await CartItem.findAll({
        where: { cart_id: guestCart.id },
        order: [["id", "ASC"]],
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      for (const guestItem of guestItems) {
        const product = await Product.findByPk(guestItem.product_id, { transaction: t, lock: t.LOCK.UPDATE });
        const variant = guestItem.product_variant_id
          ? await ProductVariant.findByPk(guestItem.product_variant_id, { transaction: t, lock: t.LOCK.UPDATE })
          : null;

        let sellable: { availableStock: number; unitPriceSource: Product | ProductVariant | null } = { availableStock: 0, unitPriceSource: null };
        if (product !== null && product.status === "active") {
          if (guestItem.product_variant_id === null) {
            sellable = { availableStock: product.stock, unitPriceSource: product };
          } else if (variant !== null && variant.active) {
            sellable = { availableStock: variant.stock, unitPriceSource: variant };
          }
        }
        const availableStock = sellable.availableStock;

        const existingCustomerItem = await CartItem.findOne({
          where: { cart_id: customerCart.id, product_id: guestItem.product_id, product_variant_id: guestItem.product_variant_id },
          transaction: t,
          lock: t.LOCK.UPDATE
        });

        const existingQuantity = existingCustomerItem?.quantity ?? 0;
        const requestedQuantity = existingQuantity + guestItem.quantity;
        const finalQuantity = Math.min(requestedQuantity, MAX_CART_ITEM_QUANTITY, availableStock);

        const lineInfo = { productId: guestItem.product_id, variantId: guestItem.product_variant_id, requestedQuantity };

        if (finalQuantity <= 0 || sellable.unitPriceSource === null) {
          mergeReport.skippedItems.push(lineInfo);
          continue;
        }

        const unitPriceSnapshot = sellable.unitPriceSource.price;

        if (existingCustomerItem) {
          existingCustomerItem.quantity = finalQuantity;
          existingCustomerItem.unit_price_snapshot = unitPriceSnapshot;
          await existingCustomerItem.save({ transaction: t });
        } else {
          const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.cartItems, t);
          await CartItem.create(
            {
              id,
              cart_id: customerCart.id,
              product_id: guestItem.product_id,
              product_variant_id: guestItem.product_variant_id,
              quantity: finalQuantity,
              unit_price_snapshot: unitPriceSnapshot
            },
            { transaction: t }
          );
        }

        if (finalQuantity < requestedQuantity) {
          mergeReport.adjustedItems.push({ ...lineInfo, finalQuantity });
        } else {
          mergeReport.mergedItems.push({ ...lineInfo, finalQuantity });
        }
      }

      await CartItem.destroy({ where: { cart_id: guestCart.id }, transaction: t });
      guestCart.status = "abandoned";
      guestCart.guest_token_hash = null;
      guestCart.coupon_id = null;
      await guestCart.save({ transaction: t });

      return { cart: await buildCartDTO(customerCart, userId, t), mergeReport };
    });
  }
};
