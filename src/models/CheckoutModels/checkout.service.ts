import { DEFAULT_COUNTRY_CODE, V1_FREE_SHIPPING_FEE } from "../../constants/database.constants.js";
import { Address } from "../../database/tables/index.js";
import { formatPaiseAsMoney, parseMoneyToPaise } from "../../utils/product-money.js";
import { CartService } from "../CartModels/cart.service.js";
import type { CartIdentity, CartItemJSON, CartJSON } from "../CartModels/cart.types.js";
import { CouponPricingService } from "../CouponModels/coupon.service.js";
import { normalizeCouponCode } from "../CouponModels/coupon.validation.js";
import type { CouponPricingLine } from "../CouponModels/coupon.types.js";
import { loadProductPaymentMethodLines, resolveCartPaymentMethods, unavailableMethodMessage } from "../ProductModels/product-payment-methods.js";
import { SettingsService } from "../SettingsModels/settings.service.js";
import { ServiceabilityService } from "../ShipmentModels/serviceability.service.js";
import { calculateGlobalOnlinePaymentDiscount, type OnlinePaymentDiscountConfig } from "./online-payment-discount.js";
import { CheckoutAddressNotFoundError, CheckoutAddressRequiredError, CheckoutCartEmptyError, CheckoutEmailRequiredError } from "./checkout.errors.js";
import type {
  CheckoutAddressCandidate,
  CheckoutCouponJSON,
  CheckoutPaymentMethod,
  CheckoutPaymentMethodOfferJSON,
  CheckoutPreviewInput,
  CheckoutPreviewJSON,
  CheckoutReadiness,
  CheckoutTotals,
  InlineAddressInput
} from "./checkout.types.js";

function toPricingLines(items: CartItemJSON[]): CouponPricingLine[] {
  return items.map((item) => ({
    productId: item.productId,
    categoryId: item.categoryId,
    unitPricePaise: parseMoneyToPaise(item.price),
    quantity: item.quantity
  }));
}

/**
 * Revalidates whichever coupon is in effect for this preview — an explicit
 * couponCode override, or else whatever's already applied on the live Cart —
 * against the CURRENT cart lines every single call. Never caches or trusts a
 * prior evaluation: a cart quantity/price/product change since the coupon
 * was applied is exactly what this re-evaluation catches (V1 requirement:
 * "revalidate coupon eligibility whenever cart quantities, products, or
 * prices change"). Returns null when no coupon is in effect at all.
 *
 * paymentMethod is forwarded to CouponPricingService.evaluateCoupon so that
 * payment-method-restricted coupons are evaluated against the customer's
 * current selection. When the coupon fails only due to payment method, the
 * alternativeSaving from the engine is forwarded to the response — the
 * frontend uses it to show the "Switch to Prepaid and save ₹X" offer without
 * computing any discount itself.
 */
async function evaluateCheckoutCoupon(
  cart: CartJSON,
  couponCodeOverride: string | undefined,
  identityUserId: number | null,
  paymentMethod?: import("./checkout.types.js").CheckoutPaymentMethod
): Promise<{ coupon: CheckoutCouponJSON; eligibleMerchandisePaise: number; discountAmountPaise: number }> {
  const effectiveCode = couponCodeOverride ?? cart.coupon?.code;
  if (!effectiveCode) {
    return { coupon: null, eligibleMerchandisePaise: 0, discountAmountPaise: 0 };
  }

  const code = normalizeCouponCode(effectiveCode);
  const lines = toPricingLines(cart.items);
  const evaluation = await CouponPricingService.evaluateCoupon({
    code,
    lines,
    identity: { userId: identityUserId },
    ...(paymentMethod ? { paymentMethod } : {})
  });

  if (evaluation.ok) {
    return {
      coupon: { code: evaluation.codeSnapshot, eligible: true, message: null },
      eligibleMerchandisePaise: evaluation.eligibleMerchandisePaise,
      discountAmountPaise: evaluation.discountAmountPaise
    };
  }
  return {
    coupon: {
      code,
      eligible: false,
      message: evaluation.message,
      // Forward the backend-authoritative alternative saving so the frontend
      // can show the exact ₹X without computing it client-side.
      ...(evaluation.reason === "payment_method_ineligible" && evaluation.alternativeSaving
        ? { alternativeSaving: evaluation.alternativeSaving }
        : {})
    },
    eligibleMerchandisePaise: 0,
    discountAmountPaise: 0
  };
}

type CheckoutPricing = {
  evaluated: Awaited<ReturnType<typeof evaluateCheckoutCoupon>>;
  onlinePaymentDiscountPaise: number;
  payableTotalPaise: number;
};

/**
 * Complete authoritative pricing of the live Cart for one payment method:
 * subtotal → coupon (existing engine, unchanged) → Global Pay Online Discount
 * on what remains → + shipping. Used for the selected method and, for the
 * switch offers, for the other method — so a saving is always the difference
 * of two complete totals, never a single discount looked at in isolation.
 */
async function priceCart(
  cart: CartJSON,
  couponCodeOverride: string | undefined,
  identityUserId: number | null,
  paymentMethod: CheckoutPaymentMethod | undefined,
  configuration: OnlinePaymentDiscountConfig,
  shippingAmountPaise: number
): Promise<CheckoutPricing> {
  const evaluated = await evaluateCheckoutCoupon(cart, couponCodeOverride, identityUserId, paymentMethod);
  const merchandiseSubtotalPaise = parseMoneyToPaise(cart.subtotal);
  const { discountAmountPaise: onlinePaymentDiscountPaise } = calculateGlobalOnlinePaymentDiscount({
    eligibleMerchandisePaise: merchandiseSubtotalPaise - evaluated.discountAmountPaise,
    paymentMethod,
    configuration
  });
  return {
    evaluated,
    onlinePaymentDiscountPaise,
    payableTotalPaise: merchandiseSubtotalPaise - evaluated.discountAmountPaise - onlinePaymentDiscountPaise + shippingAmountPaise
  };
}

function toPaymentMethodOffer(paymentMethod: CheckoutPaymentMethod, current: CheckoutPricing, alternative: CheckoutPricing): CheckoutPaymentMethodOfferJSON {
  const savingPaise = current.payableTotalPaise - alternative.payableTotalPaise;
  if (savingPaise <= 0) return null;
  return {
    paymentMethod,
    savingAmount: formatPaiseAsMoney(savingPaise),
    currentPayableTotal: formatPaiseAsMoney(current.payableTotalPaise),
    payableTotal: formatPaiseAsMoney(alternative.payableTotalPaise),
    couponCode: alternative.evaluated.coupon?.eligible ? alternative.evaluated.coupon.code : null,
    couponDiscountAmount: formatPaiseAsMoney(alternative.evaluated.discountAmountPaise),
    onlinePaymentDiscountAmount: formatPaiseAsMoney(alternative.onlinePaymentDiscountPaise)
  };
}

// Admin-facing unit for display: percent for percentage, rupees for fixed.
function formatOnlineDiscountValue(configuration: OnlinePaymentDiscountConfig): string {
  return formatPaiseAsMoney(configuration.discountValue);
}

function fromSavedAddress(address: Address): CheckoutAddressCandidate {
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

function fromInlineAddress(input: InlineAddressInput): CheckoutAddressCandidate {
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

async function resolveShippingAddress(identity: CartIdentity, input: CheckoutPreviewInput): Promise<CheckoutAddressCandidate> {
  if (identity.type === "customer" && input.savedAddressId !== undefined) {
    // Never trust browser-supplied address content when a savedAddressId is used —
    // load the authoritative owned row instead. Not found or not owned both 404.
    const address = await Address.findOne({ where: { id: input.savedAddressId, user_id: identity.userId } });
    if (!address) {
      throw new CheckoutAddressNotFoundError(input.savedAddressId);
    }
    return fromSavedAddress(address);
  }

  // Guests never resolve savedAddressId — they have no persistent address book,
  // and any savedAddressId they might supply is intentionally ignored, not looked up.
  if (input.shippingAddress) {
    return fromInlineAddress(input.shippingAddress);
  }

  throw new CheckoutAddressRequiredError();
}

export const CheckoutService = {
  async preview(identity: CartIdentity, input: CheckoutPreviewInput): Promise<CheckoutPreviewJSON> {
    // Always re-derive from the live Cart — never trust a Cart snapshot the
    // storefront fetched earlier.
    const cart = await CartService.getCart(identity);
    if (cart.items.length === 0) {
      throw new CheckoutCartEmptyError();
    }

    if (identity.type === "guest" && !input.contactEmail) {
      throw new CheckoutEmailRequiredError();
    }

    const shippingAddress = await resolveShippingAddress(identity, input);

    let billingAddress: CheckoutAddressCandidate;
    if (input.billingSameAsShipping) {
      billingAddress = shippingAddress;
    } else {
      if (!input.billingAddress) {
        // The Zod schema's cross-field refine already enforces this; this guards
        // against the type only, not a reachable runtime state.
        throw new Error("billingAddress must be present when billingSameAsShipping is false.");
      }
      billingAddress = fromInlineAddress(input.billingAddress);
    }

    // Cart may show an unavailable line; Checkout must block progressing on it.
    const cartReady = cart.items.every((item) => item.available);

    // Product-level payment availability from the persisted Product rows —
    // separate from coupon eligibility (which only affects the discount) and
    // from serviceability (which the requested method must also pass).
    const paymentMethods = resolveCartPaymentMethods(await loadProductPaymentMethodLines(cart.items.map((item) => item.productId)));
    const methodAllowedByProducts = !input.paymentMethod || paymentMethods.allowedPaymentMethods.includes(input.paymentMethod);

    const serviceability = input.paymentMethod && methodAllowedByProducts
      ? await ServiceabilityService.checkForCheckout(identity, shippingAddress.postalCode, input.paymentMethod)
      : null;
    const serviceable = serviceability?.serviceable === true;
    const paymentAllowed = methodAllowedByProducts && paymentMethods.conflict === null;

    const readiness: CheckoutReadiness = {
      cartReady,
      addressReady: true,
      shippingReady: serviceable,
      paymentReady: serviceable && paymentAllowed,
      orderReady: serviceable && paymentAllowed,
      serviceable
    };

    const identityUserId = identity.type === "customer" ? identity.userId : null;
    const shippingAmountPaise = parseMoneyToPaise(V1_FREE_SHIPPING_FEE);
    const onlineDiscountConfig = await SettingsService.getPayOnlineDiscountConfig();
    // Pass the selected payment method so payment-method-restricted coupons
    // are correctly rejected and an alternativeSaving is returned.
    const pricing = await priceCart(cart, input.couponCode, identityUserId, input.paymentMethod, onlineDiscountConfig, shippingAmountPaise);
    const { evaluated } = pricing;
    const { eligibleMerchandisePaise, discountAmountPaise } = evaluated;

    // Single switch offer per direction, from complete totals for both
    // methods. Only offered when the other method is actually allowed for
    // this cart's products (never "Pay Online & Save" on a COD-only cart).
    const canSwitch = (method: CheckoutPaymentMethod) =>
      input.paymentMethod !== undefined && input.paymentMethod !== method && paymentMethods.conflict === null && paymentMethods.allowedPaymentMethods.includes(method);
    const onlinePaymentOffer = canSwitch("payu")
      ? toPaymentMethodOffer("payu", pricing, await priceCart(cart, input.couponCode, identityUserId, "payu", onlineDiscountConfig, shippingAmountPaise))
      : null;
    const cashOnDeliveryOffer = canSwitch("cod")
      ? toPaymentMethodOffer("cod", pricing, await priceCart(cart, input.couponCode, identityUserId, "cod", onlineDiscountConfig, shippingAmountPaise))
      : null;
    // Never advertise a coupon saving through a method the cart's products
    // cannot be paid with (e.g. "Pay Online & Save" for a COD-only product).
    const coupon: CheckoutCouponJSON =
      evaluated.coupon?.alternativeSaving && !paymentMethods.allowedPaymentMethods.includes(evaluated.coupon.alternativeSaving.eligiblePaymentMethod)
        ? { code: evaluated.coupon.code, eligible: evaluated.coupon.eligible, message: evaluated.coupon.message }
        : evaluated.coupon;

    const merchandiseSubtotalPaise = parseMoneyToPaise(cart.subtotal);
    const totalBeforeDiscountPaise = merchandiseSubtotalPaise + shippingAmountPaise;

    const totals: CheckoutTotals = {
      merchandiseSubtotal: cart.subtotal,
      eligibleMerchandiseSubtotal: formatPaiseAsMoney(eligibleMerchandisePaise),
      shippingAmount: V1_FREE_SHIPPING_FEE,
      totalBeforeDiscount: formatPaiseAsMoney(totalBeforeDiscountPaise),
      discountAmount: formatPaiseAsMoney(discountAmountPaise),
      onlinePaymentDiscountAmount: formatPaiseAsMoney(pricing.onlinePaymentDiscountPaise),
      payableTotal: formatPaiseAsMoney(pricing.payableTotalPaise)
    };

    return {
      cart: {
        itemCount: cart.itemCount,
        items: cart.items,
        merchandiseSubtotal: cart.subtotal
      },
      shippingAddress,
      billingSameAsShipping: input.billingSameAsShipping,
      billingAddress,
      shipping: { status: "pending", amount: V1_FREE_SHIPPING_FEE },
      totals,
      coupon,
      onlinePaymentDiscount:
        pricing.onlinePaymentDiscountPaise > 0
          ? {
              discountType: onlineDiscountConfig.discountType,
              discountValue: formatOnlineDiscountValue(onlineDiscountConfig),
              discountAmount: formatPaiseAsMoney(pricing.onlinePaymentDiscountPaise)
            }
          : null,
      onlinePaymentOffer,
      cashOnDeliveryOffer,
      paymentMethod: input.paymentMethod ?? null,
      allowedPaymentMethods: paymentMethods.allowedPaymentMethods,
      paymentMethodConflict: paymentMethods.conflict,
      paymentMethodMessage: paymentMethods.conflict
        ? paymentMethods.conflict.message
        : input.paymentMethod && !methodAllowedByProducts
          ? unavailableMethodMessage(input.paymentMethod)
          : null,
      serviceability: serviceability ? { paymentMode: serviceability.paymentMode, serviceable: serviceability.serviceable } : null,
      readiness
    };
  }
};
