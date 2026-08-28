import { DEFAULT_CURRENCY_CODE, V1_FREE_SHIPPING_FEE } from "../../constants/database.constants.js";
import { shippingConfig } from "../../config/shipping.config.js";
import { Product, ProductVariant } from "../../database/tables/index.js";
import { ProductNotFoundError } from "../ProductModels/product.errors.js";
import { IThinkClient, IThinkClientError } from "./ithink.client.js";
import { DeliveryCheckUnavailableError } from "./shipment.errors.js";
import type { DeliveryCheckResultJSON } from "./shipment.types.js";
import type { DeliveryCheckInput } from "./serviceability.validation.js";

/**
 * Storefront Product Detail pre-purchase "check delivery to your pincode".
 *
 * READ-ONLY. Reuses the exact same verified iThink infrastructure the admin
 * booking flow uses — IThinkClient.checkServiceability (pincode/check.json)
 * and IThinkClient.getRates (rate/check.json), both of which are lookup-only.
 * It never calls order/add, never creates an Order/Shipment/AWB, never
 * reserves stock, and never touches payment.
 *
 * The customer supplies only their destination pincode. Origin pincode,
 * payment mode and package dimensions are all resolved server-side.
 */
async function checkForProduct(input: DeliveryCheckInput): Promise<DeliveryCheckResultJSON> {
  if (shippingConfig.provider !== "ithink" || !shippingConfig.ready) {
    // Same "provider not usable" situation the admin flow treats as a 503 —
    // surfaced to the storefront as the generic technical-failure message,
    // never as "we don't deliver there".
    throw new DeliveryCheckUnavailableError();
  }

  const product = await Product.findOne({ where: { id: input.productId, status: "active" } });
  if (!product) throw new ProductNotFoundError(input.productId);

  const variant = input.variantId
    ? await ProductVariant.findOne({ where: { id: input.variantId, product_id: product.id, active: true } })
    : null;
  if (input.variantId && !variant) throw new ProductNotFoundError(input.variantId);

  const quantity = input.quantity ?? 1;
  const weightGrams = variant?.weight_grams ?? product.weight_grams;
  const length = Number(variant?.length_cm ?? product.length_cm);
  const width = Number(variant?.width_cm ?? product.width_cm);
  const height = Number(variant?.height_cm ?? product.height_cm);
  const unitPrice = Number(variant?.price ?? product.price);
  // getRates needs real package measurements; serviceability itself doesn't.
  // A product with no dimensions still gets a serviceable / not-serviceable
  // answer — just no ETA window (honest "estimate unavailable", never a
  // fabricated date).
  const hasPackageData =
    typeof weightGrams === "number" && weightGrams > 0 &&
    [length, width, height].every((value) => Number.isFinite(value) && value > 0);

  // Pre-purchase checks are always evaluated as a prepaid forward shipment —
  // the customer has not chosen a payment method yet, and pincode-based COD
  // eligibility is a separate, separately-approved concern.
  const paymentMode = "prepaid" as const;

  try {
    const serviceable = await IThinkClient.checkServiceability(input.pincode, paymentMode);
    if (serviceable.length === 0) {
      return { pincode: input.pincode, serviceable: false, estimatedDelivery: null, deliveryCharge: null };
    }

    let estimatedDelivery: { min: string; max: string } | null = null;
    if (hasPackageData) {
      // V1 packaging rule mirrors ShipmentService.aggregate(): the largest
      // footprint is retained and per-unit heights are summed.
      const rates = await IThinkClient.getRates({
        toPincode: input.pincode,
        lengthCm: length.toFixed(2),
        widthCm: width.toFixed(2),
        heightCm: (height * quantity).toFixed(2),
        weightKg: ((weightGrams * quantity) / 1000).toFixed(3),
        productMrp: (unitPrice * quantity).toFixed(2),
        paymentMode
      });
      // edd_date is a single min/max window shared across the whole rate
      // response (see IThinkClient.getRates) — take it verbatim from any
      // serviceable candidate that carries one. Never today + delivery_tat,
      // never an invented fallback.
      estimatedDelivery =
        rates.find((rate) => serviceable.includes(rate.courier.toLowerCase()) && rate.estimatedDelivery)?.estimatedDelivery ?? null;
    }

    return {
      pincode: input.pincode,
      serviceable: true,
      estimatedDelivery,
      // The existing V1 storefront shipping rule — the same
      // V1_FREE_SHIPPING_FEE that Checkout Preview and Order creation already
      // apply. No new shipping-price calculation is introduced here, and the
      // raw per-courier iThink rate (which is not what the customer pays) is
      // never exposed.
      deliveryCharge: {
        free: Number.parseFloat(V1_FREE_SHIPPING_FEE) === 0,
        amount: V1_FREE_SHIPPING_FEE,
        currency: DEFAULT_CURRENCY_CODE
      }
    };
  } catch (error) {
    // Any provider-side rejection, timeout, network failure or malformed
    // response collapses to one generic customer-facing message — the raw
    // IThinkClientError (code + provider text) is swallowed here.
    if (error instanceof IThinkClientError) throw new DeliveryCheckUnavailableError();
    throw error;
  }
}

export const ServiceabilityService = { checkForProduct };
