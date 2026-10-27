import { parseMoneyToPaise } from "../../utils/product-money.js";
import { toProviderAmount, type BreezeAmountUnit } from "./breeze-money.js";
import type { CartJSON } from "../CartModels/cart.types.js";

// Breeze Cart Object per docs.breeze.in/cart-sign-api:
//   { id, initialPrice, totalPrice, totalDiscount, weight?, itemCount, currency,
//     items[{ id, title, variantTitle?, variantId?, image?, weight?, quantity,
//             discount, initialPrice, finalPrice }] }
//
// UNCONFIRMED WITH BREEZE (see BREEZE_1CCO_IMPLEMENTATION_REPORT.md):
//   - money unit: this builder emits integer PAISE (the backend SDK README says
//     "smallest unit"); the Order Create Webhook example shows decimals.
//   - item-level initialPrice/finalPrice: emitted PER UNIT, with `quantity`.
// Totals come only from the server-side Cart, never from the browser.
export type BreezeCartItem = {
  id: string;
  title: string;
  variantTitle?: string;
  variantId?: string;
  image?: string;
  quantity: number;
  discount: number;
  initialPrice: number;
  finalPrice: number;
};

export type BreezeCartObject = {
  id: string;
  initialPrice: number;
  totalPrice: number;
  totalDiscount: number;
  itemCount: number;
  currency: string;
  items: BreezeCartItem[];
};

export function buildBreezeCartObject(cart: CartJSON, merchantCartId: string, unit: BreezeAmountUnit = "paise"): BreezeCartObject {
  const items: BreezeCartItem[] = cart.items.map((item) => {
    const unitPaise = parseMoneyToPaise(item.price);
    return {
      id: String(item.cartItemId),
      title: item.productName,
      ...(item.variantName ? { variantTitle: item.variantName } : {}),
      ...(item.variantId !== null ? { variantId: String(item.variantId) } : {}),
      ...(item.image ? { image: item.image.url } : {}),
      quantity: item.quantity,
      discount: 0,
      initialPrice: toProviderAmount(unitPaise, unit),
      finalPrice: toProviderAmount(unitPaise, unit)
    };
  });
  // Integer-paise arithmetic from the server cart, converted once at the edge.
  const totalPaise = cart.items.reduce((sum, item) => sum + parseMoneyToPaise(item.price) * item.quantity, 0);
  return {
    id: merchantCartId,
    initialPrice: toProviderAmount(totalPaise, unit),
    totalPrice: toProviderAmount(totalPaise, unit),
    totalDiscount: 0,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    currency: "INR",
    items
  };
}
