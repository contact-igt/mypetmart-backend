import { DEFAULT_COUNTRY_CODE, V1_FREE_SHIPPING_FEE } from "../../constants/database.constants.js";
import { Address } from "../../database/tables/index.js";
import { formatPaiseAsMoney, parseMoneyToPaise } from "../../utils/product-money.js";
import { CartService } from "../CartModels/cart.service.js";
import type { CartIdentity, CartItemJSON, CartJSON } from "../CartModels/cart.types.js";
import { CouponPricingService } from "../CouponModels/coupon.service.js";
import { normalizeCouponCode } from "../CouponModels/coupon.validation.js";
import type { CouponPricingLine } from "../CouponModels/coupon.types.js";
import { ServiceabilityService } from "../ShipmentModels/serviceability.service.js";
import { CheckoutAddressNotFoundError, CheckoutAddressRequiredError, CheckoutCartEmptyError, CheckoutEmailRequiredError } from "./checkout.errors.js";
import type {
  CheckoutAddressCandidate,
  CheckoutCouponJSON,
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
    const serviceability = input.paymentMethod
      ? await ServiceabilityService.checkForCheckout(identity, shippingAddress.postalCode, input.paymentMethod)
      : null;
    const serviceable = serviceability?.serviceable === true;

    const readiness: CheckoutReadiness = {
      cartReady,
      addressReady: true,
      shippingReady: serviceable,
      paymentReady: serviceable,
      orderReady: serviceable,
      serviceable
    };

    const identityUserId = identity.type === "customer" ? identity.userId : null;
    // Pass the selected payment method so payment-method-restricted coupons
    // are correctly rejected and an alternativeSaving is returned.
    const { coupon, eligibleMerchandisePaise, discountAmountPaise } = await evaluateCheckoutCoupon(cart, input.couponCode, identityUserId, input.paymentMethod);

    const shippingAmountPaise = parseMoneyToPaise(V1_FREE_SHIPPING_FEE);
    const merchandiseSubtotalPaise = parseMoneyToPaise(cart.subtotal);
    const totalBeforeDiscountPaise = merchandiseSubtotalPaise + shippingAmountPaise;
    const payableTotalPaise = totalBeforeDiscountPaise - discountAmountPaise;

    const totals: CheckoutTotals = {
      merchandiseSubtotal: cart.subtotal,
      eligibleMerchandiseSubtotal: formatPaiseAsMoney(eligibleMerchandisePaise),
      shippingAmount: V1_FREE_SHIPPING_FEE,
      totalBeforeDiscount: formatPaiseAsMoney(totalBeforeDiscountPaise),
      discountAmount: formatPaiseAsMoney(discountAmountPaise),
      payableTotal: formatPaiseAsMoney(payableTotalPaise)
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
      paymentMethod: input.paymentMethod ?? null,
      serviceability: serviceability ? { paymentMode: serviceability.paymentMode, serviceable: serviceability.serviceable } : null,
      readiness
    };
  }
};
