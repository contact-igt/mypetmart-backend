import crypto from "node:crypto";

import { Op } from "sequelize";

import { paymentConfig } from "../../config/payment.config.js";
import { DATABASE_TABLE_NAMES, V1_FREE_SHIPPING_FEE } from "../../constants/database.constants.js";
import { sequelize } from "../../database/index.js";
import { IdSequenceService } from "../../database/sequences/id-sequence.service.js";
import { BreezeCheckoutSession, Product, ProductVariant } from "../../database/tables/index.js";
import { parseMoneyToPaise } from "../../utils/product-money.js";
import { CartService } from "../CartModels/cart.service.js";
import { calculateGlobalOnlinePaymentDiscount } from "../CheckoutModels/online-payment-discount.js";
import type { CartIdentity } from "../CartModels/cart.types.js";
import { isBelowPrepaidMinimum, PrepaidMinimumPayableError } from "../CheckoutModels/prepaid-minimum.js";
import { SettingsService } from "../SettingsModels/settings.service.js";
import { resolveCartPaymentMethods, unavailableMethodMessage } from "../ProductModels/product-payment-methods.js";
import { buildBreezeCartObject } from "./breeze-cart-builder.js";
import { assertNoBlockingAttempt } from "./breeze-attempt-guard.js";
import { assertNoPendingPayuForCart, lockCartForCheckout } from "./breeze-cross-provider.js";
import type { BreezeOrderIntent, BreezeOrderIntentLine } from "./breeze-order-intent.js";
import { signBreezeCart } from "./breeze-signature.util.js";
import { PaymentError } from "./payment.errors.js";

export type BreezeCheckoutSessionJSON = {
  sessionId: string;
  // Breeze Web SDK initiate() payload values (non-secret).
  merchantId: string;
  environment: string;
  shopUrl: string;
  // startCheckout request values.
  cart: string; // JSON.stringify(Breeze Cart Object) — exactly what was signed
  signature: string;
  keyId: string;
  amountPaise: number;
  currency: string;
  expiresAt: string;
};

export class BreezeCheckoutDisabledError extends PaymentError {
  public constructor() {
    super("BREEZE_CHECKOUT_UNAVAILABLE", "Breeze checkout is not available.", 404);
    this.name = "BreezeCheckoutDisabledError";
  }
}

class BreezeCheckoutRejectedError extends PaymentError {
  public constructor(code: string, message: string, details?: unknown) {
    super(code, message, 422, details);
    this.name = "BreezeCheckoutRejectedError";
  }
}

export const BreezeCheckoutSessionService = {
  /**
   * Validates the live server Cart, builds + signs the Breeze cart on the
   * backend, and persists a durable session carrying an immutable order-intent
   * snapshot (the only thing the Order Create webhook will ever build an Order
   * from). No provider network call, no Order/stock/coupon mutation. Hidden
   * (404) unless every 1CCO setting — including BREEZE_AMOUNT_UNIT — is
   * configured AND BREEZE_1CCO_ENABLED=true.
   */
  async createSession(identity: CartIdentity): Promise<BreezeCheckoutSessionJSON> {
    const privateKey = paymentConfig.breezeCartPrivateKey;
    const unit = paymentConfig.breezeAmountUnit;
    if (!paymentConfig.breeze1ccoReady || !privateKey || !unit || !paymentConfig.breezeKeyId || !paymentConfig.breezeMerchantId || !paymentConfig.breezeEnvironment) {
      throw new BreezeCheckoutDisabledError();
    }

    // An earlier attempt for this customer/guest may already have captured
    // money. Refuse (machine-readable reason) until a webhook result or an
    // audited admin release resolves it. Checked across all carts.
    await assertNoBlockingAttempt(identity);

    const cart = await CartService.getCart(identity);
    if (cart.id === null || cart.items.length === 0) {
      throw new BreezeCheckoutRejectedError("BREEZE_CART_EMPTY", "Your cart is empty.");
    }
    if (cart.items.some((item) => !item.available || item.quantity > item.availableQuantity)) {
      throw new BreezeCheckoutRejectedError("BREEZE_CART_UNAVAILABLE", "Some items in your cart are no longer available. Please review your cart.");
    }
    // Coupons and the Pay Online discount are not expressed in the Breeze cart
    // in this version; refusing is safer than charging a different total.
    if (cart.coupon) {
      throw new BreezeCheckoutRejectedError("BREEZE_COUPON_UNSUPPORTED", "Remove the applied coupon to use this checkout, or use standard checkout.");
    }
    const methods = resolveCartPaymentMethods(cart.items.map((item) => ({ productId: item.productId, productName: item.productName, eligibility: item.paymentMethodEligibility })));
    if (!methods.allowedPaymentMethods.includes("payu")) {
      throw new BreezeCheckoutRejectedError("BREEZE_PAYMENT_METHOD_NOT_ALLOWED", unavailableMethodMessage("payu"), { allowedPaymentMethods: methods.allowedPaymentMethods });
    }

    // The Global Pay Online discount is a MyPetMart prepaid price rule. The
    // signed Breeze cart does not express it, so a non-zero discount here would
    // make Breeze charge the undiscounted price. Refuse, with standard-checkout
    // fallback, until the provider representation is verified.
    const subtotalPaise = cart.items.reduce((sum, item) => sum + parseMoneyToPaise(item.price) * item.quantity, 0);
    if (subtotalPaise !== parseMoneyToPaise(cart.subtotal)) {
      throw new BreezeCheckoutRejectedError("BREEZE_CART_TOTAL_MISMATCH", "Cart total could not be verified. Please refresh your cart.");
    }
    const onlineDiscount = calculateGlobalOnlinePaymentDiscount({
      eligibleMerchandisePaise: subtotalPaise,
      paymentMethod: "payu",
      configuration: await SettingsService.getPayOnlineDiscountConfig()
    });
    if (onlineDiscount.discountAmountPaise > 0) {
      throw new BreezeCheckoutRejectedError("BREEZE_ONLINE_DISCOUNT_UNSUPPORTED", "Pay Online pricing is not available through this checkout. Please use standard checkout.");
    }
    const shippingFeePaise = parseMoneyToPaise(V1_FREE_SHIPPING_FEE);
    const totalPaise = subtotalPaise + shippingFeePaise;
    if (shippingFeePaise !== 0) {
      // The signed Breeze cart has no shipping field; a non-zero fee would make
      // the charged total differ from the quote.
      throw new BreezeCheckoutRejectedError("BREEZE_SHIPPING_UNSUPPORTED", "This checkout cannot be used while shipping is charged.");
    }
    if (isBelowPrepaidMinimum("payu", totalPaise)) {
      throw new PrepaidMinimumPayableError(totalPaise);
    }

    // Immutable order intent — SKUs and category come from the persisted rows
    // (not the browser), prices from the live server cart at signing time.
    const productIds = [...new Set(cart.items.map((item) => item.productId))];
    const variantIds = cart.items.map((item) => item.variantId).filter((id): id is number => id !== null);
    const products = await Product.findAll({ where: { id: productIds } });
    const variants = variantIds.length > 0 ? await ProductVariant.findAll({ where: { id: variantIds } }) : [];
    const productById = new Map(products.map((product) => [product.id, product]));
    const variantById = new Map(variants.map((variant) => [variant.id, variant]));

    const lines: BreezeOrderIntentLine[] = cart.items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) {
        throw new BreezeCheckoutRejectedError("BREEZE_CART_UNAVAILABLE", "Some items in your cart are no longer available. Please review your cart.");
      }
      const variant = item.variantId !== null ? (variantById.get(item.variantId) ?? null) : null;
      return {
        productId: item.productId,
        categoryId: item.categoryId,
        variantId: item.variantId,
        productName: item.productName,
        productSku: product.sku,
        variantName: item.variantName,
        variantSku: variant ? variant.sku : null,
        productImage: item.image ? item.image.url : null,
        quantity: item.quantity,
        unitPricePaise: parseMoneyToPaise(item.price),
        paymentMethodEligibility: item.paymentMethodEligibility
      };
    });
    const orderIntent: BreezeOrderIntent = { version: 1, lines, subtotalPaise, shippingFeePaise, totalPaise, currency: "INR" };

    const publicId = crypto.randomBytes(16).toString("hex");
    const breezeCart = buildBreezeCartObject(cart, publicId, unit);
    const stringifiedCart = JSON.stringify(breezeCart);
    const signature = signBreezeCart(stringifiedCart, privateKey);
    const cartHash = crypto.createHash("sha256").update(stringifiedCart, "utf8").digest("hex");
    const expiresAt = new Date(Date.now() + paymentConfig.breeze1ccoSessionTtlMinutes * 60_000);
    const cartId = cart.id;

    await sequelize.transaction(async (t) => {
      // Race-safe ordering: the cart lock is the FIRST statement, so every read
      // below sees the state committed by any concurrent start for this cart.
      // Then re-check (a) an unresolved PayU payment for the cart, and (b) the
      // identity-wide Breeze attempt guard. Both refusals roll the transaction back.
      await lockCartForCheckout(cartId, t);
      await assertNoPendingPayuForCart(cartId, t);
      await assertNoBlockingAttempt(identity, t);

      // Retiring an older unfinished session only stops it being LAUNCHED again;
      // a late captured payment for it is still processed by the webhook bridge
      // (which never consults status/expiry).
      await BreezeCheckoutSession.update({ status: "expired" }, { where: { cart_id: cartId, status: "created" }, transaction: t });
      const id = await IdSequenceService.allocateNextId(DATABASE_TABLE_NAMES.breezeCheckoutSessions, t);
      await BreezeCheckoutSession.create(
        {
          id,
          public_id: publicId,
          user_id: identity.type === "customer" ? identity.userId : null,
          guest_identity_hash: identity.type === "guest" ? identity.tokenHash : null,
          cart_id: cartId,
          cart_hash: cartHash,
          amount_paise: totalPaise,
          cart_snapshot: breezeCart,
          order_intent: orderIntent,
          breeze_checkout_id: null,
          order_id: null,
          breeze_cart_id: null,
          breeze_order_id: null,
          breeze_txn_id: null,
          payment_id: null,
          last_event_id: null,
          last_error_code: null,
          expires_at: expiresAt
        },
        { transaction: t }
      );
    });

    return {
      sessionId: publicId,
      merchantId: paymentConfig.breezeMerchantId,
      environment: paymentConfig.breezeEnvironment,
      shopUrl: paymentConfig.breezeShopUrl,
      cart: stringifiedCart,
      signature,
      keyId: paymentConfig.breezeKeyId,
      amountPaise: totalPaise,
      currency: breezeCart.currency,
      expiresAt: expiresAt.toISOString()
    };
  },

  /** Marks unfinished sessions past their expiry. Safe to call from a job. */
  async expireStaleSessions(now: Date = new Date()): Promise<number> {
    const [count] = await BreezeCheckoutSession.update({ status: "expired" }, { where: { status: "created", expires_at: { [Op.lt]: now } } });
    return count;
  }
};
