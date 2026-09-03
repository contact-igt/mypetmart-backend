import type { Order } from "../../database/tables/OrderTable/index.js";
import type { ReturnRequest } from "../../database/tables/ReturnRequestTable/index.js";

// The physical address a reverse courier collects the returned item from.
// Shown on the Admin return detail, rate-checked in the return-shipment
// quote, and sent to iThink as the pickup contact when the reverse shipment
// is booked.
export type ReturnPickupAddressJSON = {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  // true when this return carries an admin-entered override (any pickup_*
  // column set); false when it is resolving straight from the Order's own
  // shipping snapshot. Purely informational for the UI.
  edited: boolean;
};

// Resolve the effective pickup address as `pickup_* ?? order.ship_*` per
// field. A ReturnRequest with no override behaves exactly as the reverse
// shipment flow did before migration 064 (it read order.ship_* directly).
// This is the single source of truth for every reader — detail DTO, quote,
// and booking — so they can never disagree about where the courier goes.
export function resolvePickupAddress(returnRequest: ReturnRequest, order: Order): ReturnPickupAddressJSON {
  const edited = Boolean(
    returnRequest.pickup_recipient_name ??
      returnRequest.pickup_phone ??
      returnRequest.pickup_line_1 ??
      returnRequest.pickup_line_2 ??
      returnRequest.pickup_city ??
      returnRequest.pickup_state ??
      returnRequest.pickup_postal_code
  );
  return {
    recipientName: returnRequest.pickup_recipient_name ?? order.ship_recipient_name,
    phone: returnRequest.pickup_phone ?? order.ship_phone,
    line1: returnRequest.pickup_line_1 ?? order.ship_line_1,
    line2: returnRequest.pickup_line_2 ?? (edited ? null : order.ship_line_2),
    city: returnRequest.pickup_city ?? order.ship_city,
    state: returnRequest.pickup_state ?? order.ship_state,
    postalCode: returnRequest.pickup_postal_code ?? order.ship_postal_code,
    country: returnRequest.pickup_country ?? order.ship_country,
    edited
  };
}
