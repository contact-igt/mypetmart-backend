import { DEFAULT_COUNTRY_CODE } from "../../constants/database.constants.js";
import { Address } from "../../database/tables/index.js";
import { CartService } from "../CartModels/cart.service.js";
import type { CartIdentity } from "../CartModels/cart.types.js";
import { CheckoutAddressNotFoundError, CheckoutAddressRequiredError, CheckoutCartEmptyError } from "./checkout.errors.js";
import type {
  CheckoutAddressCandidate,
  CheckoutPreviewInput,
  CheckoutPreviewJSON,
  CheckoutReadiness,
  InlineAddressInput
} from "./checkout.types.js";

function fromSavedAddress(address: Address): CheckoutAddressCandidate {
  return {
    recipientName: address.recipient_name,
    phone: address.phone,
    line1: address.line_1,
    line2: address.line_2,
    city: address.city,
    state: address.state,
    postalCode: address.postal_code,
    country: address.country
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
    country: input.country ?? DEFAULT_COUNTRY_CODE
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

    const readiness: CheckoutReadiness = {
      cartReady,
      addressReady: true,
      shippingReady: false,
      paymentReady: false,
      orderReady: false
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
      shipping: { status: "pending", amount: null },
      totals: {
        merchandiseSubtotal: cart.subtotal,
        shippingAmount: null,
        payableTotal: null
      },
      readiness
    };
  }
};
