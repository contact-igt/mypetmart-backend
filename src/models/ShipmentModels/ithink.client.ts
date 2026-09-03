import { shippingConfig } from "../../config/shipping.config.js";

type JsonRecord = Record<string, unknown>;

export type IThinkPackageInput = {
  orderNumber: string;
  orderDate: string;
  totalAmount: string;
  recipient: { name: string; address1: string; address2: string; pincode: string; city: string; state: string; country: string; phone: string; email: string };
  products: Array<{ name: string; sku: string; quantity: number; price: string }>;
  lengthCm: string;
  widthCm: string;
  heightCm: string;
  weightKg: string;
  logistics: string;
  serviceType: string;
  // Determined server-side by ShipmentService from the Order's own Payment
  // records (see createInput's isCod derivation) — never trusted from any
  // client input. "COD" carries codAmount = the payable total (nothing was
  // captured upfront); "Prepaid" always sends codAmount "0".
  paymentMode: "Prepaid" | "COD";
  codAmount: string;
};

export type IThinkTrackingEvent = { status: string; statusCode: string | null; location: string | null; message: string | null; eventAt: string };
// currentStatus is null exclusively to signal "iThink has no tracking data
// for this AWB yet" (see track()'s own comment) — never a fabricated/guessed
// status. Every other field keeps its existing meaning.
export type IThinkTrackingResult = { awb: string; courier: string | null; currentStatus: string | null; currentStatusCode: string | null; events: IThinkTrackingEvent[] };

export class IThinkClientError extends Error {
  public constructor(public readonly code: string, message: string, public readonly uncertain = false) { super(message); this.name = "IThinkClientError"; }
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}
function text(value: unknown): string | null { return typeof value === "string" || typeof value === "number" ? String(value) : null; }
function success(value: unknown): boolean { return text(value)?.toLowerCase() === "success"; }

const TRACKING_PATH = "/api_v3/order/track.json";
// delivery_tat arrives as a numeric-looking string (e.g. "4") — a non-numeric
// or non-positive value is treated as absent rather than stored as garbage.
function positiveInt(value: unknown): number | null {
  const parsed = Number.parseInt(text(value) ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
// edd_date's min_edd/max_edd are plain calendar dates ("2026-08-29"), never
// a timestamp — validated by shape so a malformed/missing value degrades to
// "no estimate" instead of being passed through unchecked.
function isoDate(value: unknown): string | null {
  const parsed = text(value);
  return parsed && /^\d{4}-\d{2}-\d{2}$/u.test(parsed) ? parsed : null;
}

function credentials(): { access_token: string; secret_key: string } {
  if (!shippingConfig.accessToken || !shippingConfig.secretKey) throw new IThinkClientError("NOT_CONFIGURED", "iThink credentials are not configured.");
  return { access_token: shippingConfig.accessToken, secret_key: shippingConfig.secretKey };
}

type IThinkPostOptions = { tracking?: boolean; create?: boolean; mutating?: boolean };
type IThinkTrackingPostOptions = IThinkPostOptions & { tracking: true };

async function post(path: string, data: JsonRecord, options: IThinkTrackingPostOptions): Promise<JsonRecord | []>;
async function post(path: string, data: JsonRecord, options?: IThinkPostOptions): Promise<JsonRecord>;
async function post(path: string, data: JsonRecord, options: IThinkPostOptions = {}): Promise<JsonRecord | []> {
  const baseUrl = options.tracking ? shippingConfig.trackingBaseUrl : shippingConfig.apiBaseUrl;
  const isTrackingRequest = options.tracking === true && path === TRACKING_PATH;
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "cache-control": "no-cache" },
      body: JSON.stringify({ data: { ...data, ...credentials() } }),
      signal: AbortSignal.timeout(shippingConfig.timeoutMs)
    });
  } catch {
    throw new IThinkClientError(options.create ? "CREATE_UNCERTAIN" : "PROVIDER_UNAVAILABLE", "iThink Logistics did not return a response.", Boolean(options.create || options.mutating));
  }
  if (!response.ok) throw new IThinkClientError("PROVIDER_UNAVAILABLE", `iThink Logistics returned HTTP ${response.status}.`, Boolean(options.create || options.mutating));
  const parsed: unknown = await response.json().catch(() => undefined);
  if (isTrackingRequest && Array.isArray(parsed) && parsed.length === 0) return [];
  const payload = record(parsed);
  if (!payload) throw new IThinkClientError("INVALID_RESPONSE", "iThink Logistics returned an invalid response.", Boolean(options.create || options.mutating));
  return payload;
}

// "prepaid" (PayU — funds already captured) vs "cod" (funds collected on
// delivery) — determines both the payment_method value iThink is asked
// about and which per-courier capability flag (prepaid/cod) a candidate
// must have "Y" for. Derived server-side from the Order's own Payment
// record by ShipmentService (see prepared.isCod) — this client itself
// never decides payment mode, only receives it.
export type IThinkPaymentMode = "prepaid" | "cod";

export const IThinkClient = {
  async checkServiceability(pincode: string, paymentMode: IThinkPaymentMode): Promise<string[]> {
    const payload = await post("/api_v3/pincode/check.json", { pincode });
    if (!success(payload.status)) throw new IThinkClientError("SERVICEABILITY_CHECK_FAILED", text(payload.html_message) ?? text(payload.message) ?? "iThink Logistics rejected the pincode check.");
    const courierMap = record(record(payload.data)?.[pincode]);
    if (!courierMap) return [];
    return Object.entries(courierMap)
      .filter(([, details]) => { const row = record(details); return text(row?.[paymentMode])?.toUpperCase() === "Y" && text(row?.pickup)?.toUpperCase() === "Y"; })
      .map(([name]) => name.toLowerCase());
  },

  // deliveryTat/estimatedDelivery are declared optional here (not `| null`
  // required) purely so every pre-existing test mock of this function that
  // predates ETA capture keeps compiling unchanged — the real implementation
  // below always sets both explicitly (to a value or to null), never omits
  // them. Verified live against the account configured in shipping.config.ts
  // (Phase 2A.1): delivery_tat is per-courier, edd_date is one shared
  // min/max window for the whole rate-check response (not per courier).
  async getRates(input: { toPincode: string; lengthCm: string; widthCm: string; heightCm: string; weightKg: string; productMrp: string; paymentMode: IThinkPaymentMode }): Promise<Array<{ courier: string; serviceType: string; rate: string; deliveryTat?: number | null; estimatedDelivery?: { min: string; max: string } | null }>> {
    if (!shippingConfig.originPincode) throw new IThinkClientError("NOT_CONFIGURED", "Origin pincode is not configured.");
    const payload = await post("/api_v3/rate/check.json", {
      from_pincode: shippingConfig.originPincode,
      to_pincode: input.toPincode,
      shipping_length_cms: input.lengthCm,
      shipping_width_cms: input.widthCm,
      shipping_height_cms: input.heightCm,
      shipping_weight_kg: input.weightKg,
      order_type: "forward",
      payment_method: input.paymentMode,
      product_mrp: input.productMrp,
      delivery_type: "0"
    });
    if (!success(payload.status) || !Array.isArray(payload.data)) return [];
    const eddRecord = record(payload.edd_date);
    const minEdd = isoDate(eddRecord?.min_edd);
    const maxEdd = isoDate(eddRecord?.max_edd);
    const estimatedDelivery = minEdd && maxEdd ? { min: minEdd, max: maxEdd } : null;
    return payload.data.flatMap((value) => {
      const row = record(value);
      const courier = text(row?.logistic_name);
      const rate = text(row?.rate);
      if (!courier || !rate || text(row?.[input.paymentMode])?.toUpperCase() !== "Y" || text(row?.pickup)?.toUpperCase() !== "Y") return [];
      return [{ courier, serviceType: text(row?.logistic_service_type) ?? "", rate, deliveryTat: positiveInt(row?.delivery_tat), estimatedDelivery }];
    });
  },

  async createShipment(input: IThinkPackageInput): Promise<{ awb: string | null; reference: string | null; courier: string | null; trackingUrl: string | null }> {
    if (!shippingConfig.pickupAddressId || !shippingConfig.returnAddressId) throw new IThinkClientError("NOT_CONFIGURED", "iThink warehouse configuration is incomplete.");
    if (!shippingConfig.storeId) throw new IThinkClientError("NOT_CONFIGURED", "iThink store ID is not configured.");
    const address = input.recipient;
    const payload = await post("/api_v3/order/add.json", {
      shipments: [{
        waybill: "", order: input.orderNumber, sub_order: "", order_date: input.orderDate, total_amount: input.totalAmount,
        name: address.name, company_name: "", add: address.address1, add2: address.address2, add3: "", pin: address.pincode,
        city: address.city, state: address.state, country: address.country, phone: address.phone, alt_phone: "", email: address.email,
        is_billing_same_as_shipping: "yes", billing_name: address.name, billing_company_name: "", billing_add: address.address1,
        billing_add2: address.address2, billing_add3: "", billing_pin: address.pincode, billing_city: address.city,
        billing_state: address.state, billing_country: address.country, billing_phone: address.phone, billing_alt_phone: "", billing_email: address.email,
        products: input.products.map((product) => ({ product_name: product.name, product_sku: product.sku, product_quantity: String(product.quantity), product_price: product.price, product_discount: "0" })),
        shipment_length: input.lengthCm, shipment_width: input.widthCm, shipment_height: input.heightCm, weight: input.weightKg,
        shipping_charges: "0", giftwrap_charges: "0", transaction_charges: "0", total_discount: "0", first_attemp_discount: "0",
        // Prepaid: the full amount was already captured by PayU, so nothing
        // is collected on delivery (cod_amount "0"). COD: nothing was
        // captured upfront (advance_amount "0"), the full amount is
        // collected on delivery (cod_amount = codAmount).
        cod_charges: "0",
        advance_amount: input.paymentMode === "COD" ? "0" : input.totalAmount,
        cod_amount: input.paymentMode === "COD" ? input.codAmount : "0",
        payment_mode: input.paymentMode,
        reseller_name: "", eway_bill_number: "", gst_number: "",
        return_address_id: shippingConfig.returnAddressId,
        store_id: shippingConfig.storeId
      }],
      pickup_address_id: shippingConfig.pickupAddressId,
      logistics: input.logistics,
      s_type: input.serviceType,
      order_type: "forward"
    }, { create: true });
    const data = record(payload.data);
    const result = data ? record(Object.values(data)[0]) : undefined;
    if (!success(payload.status) || !result || !success(result.status)) {
      throw new IThinkClientError("CREATE_REJECTED", text(result?.remark) ?? text(payload.html_message) ?? "iThink Logistics rejected the shipment.");
    }
    return { awb: text(result.waybill), reference: text(result.refnum), courier: text(result.logistic_name), trackingUrl: text(result.tracking_url) };
  },

  async track(awb: string): Promise<IThinkTrackingResult> {
    const payload = await post("/api_v3/order/track.json", { awb_number_list: awb }, { tracking: true });
    if (Array.isArray(payload)) return { awb, courier: null, currentStatus: null, currentStatusCode: null, events: [] };
    const dataRecord = record(payload.data);
    const result = dataRecord ? record(dataRecord[awb]) : undefined;
    if (!result) {
      // A freshly-created/manifested AWB the courier hasn't scanned yet is
      // NOT a provider failure — iThink reports "nothing to report for this
      // AWB yet" by omitting a per-AWB entry entirely, via an empty `data`
      // array (instead of the usual { [awb]: {...} } map) or an empty data
      // object. Only treated as the benign "no scans yet" case when the
      // top-level response itself reports success; an empty/missing data
      // payload alongside an explicit provider rejection still throws below
      // — this never weakens what already counts as a real failure.
      const dataIsEmpty = (Array.isArray(payload.data) && payload.data.length === 0) || (dataRecord !== undefined && Object.keys(dataRecord).length === 0);
      if (dataIsEmpty && success(payload.status)) {
        return { awb, courier: null, currentStatus: null, currentStatusCode: null, events: [] };
      }
      throw new IThinkClientError("TRACKING_UNAVAILABLE", "Tracking is not currently available for this AWB.");
    }
    if (text(result.message)?.toLowerCase() !== "success") throw new IThinkClientError("TRACKING_UNAVAILABLE", "Tracking is not currently available for this AWB.");
    const events = Array.isArray(result.scan_details) ? result.scan_details.flatMap((value) => {
      const row = record(value); const status = text(row?.status); const eventAt = text(row?.scan_date_time);
      if (!status || !eventAt) return [];
      return [{ status, statusCode: text(row?.status_code), location: text(row?.scan_location), message: text(row?.status_reason) ?? text(row?.remark), eventAt }];
    }) : [];
    return { awb: text(result.awb_no) ?? awb, courier: text(result.logistic), currentStatus: text(result.current_status) ?? "Unknown", currentStatusCode: text(result.current_status_code), events };
  },

  async cancel(awb: string): Promise<void> {
    const payload = await post("/api_v3/order/cancel.json", { awb_numbers: awb }, { mutating: true });
    if (!success(payload.status)) throw new IThinkClientError("CANCELLATION_REJECTED", text(payload.remark) ?? text(payload.html_message) ?? "iThink Logistics rejected cancellation.");

    const data = payload.data;
    const identityFields = ["awb", "awb_no", "awb_number", "waybill", "tracking_number"];
    const identity = (result: JsonRecord): string | null => {
      for (const field of identityFields) {
        const value = text(result[field]);
        if (value) return value;
      }
      const numbers = result.awb_numbers;
      if (Array.isArray(numbers) && numbers.length === 1) return text(numbers[0]);
      return text(numbers);
    };
    const matching = (result: JsonRecord): boolean => {
      const resultAwb = identity(result);
      return resultAwb === null || resultAwb.trim() === awb.trim();
    };

    let result: JsonRecord | undefined;
    if (Array.isArray(data)) {
      const records = data.flatMap((value) => { const row = record(value); return row ? [row] : []; });
      const exact = records.filter((row) => identity(row)?.trim() === awb.trim());
      if (exact.length === 1) result = exact[0];
      else if (records.length === 1 && matching(records[0]!)) result = records[0];
    } else if (record(data)) {
      const dataRecord = record(data)!;
      const direct = record(dataRecord[awb]);
      if (direct && matching(direct)) {
        result = direct;
      } else {
        const entries = Object.entries(dataRecord).flatMap(([key, value]) => {
          const row = record(value);
          return row ? [{ key, row }] : [];
        });
        const exact = entries.filter(({ key, row }) => key === awb || identity(row)?.trim() === awb.trim());
        if (exact.length === 1) result = exact[0]!.row;
        else if (entries.length === 1 && ["0", "1"].includes(entries[0]!.key) && matching(entries[0]!.row)) result = entries[0]!.row;
      }
    }

    if (!result) throw new IThinkClientError("CANCELLATION_AMBIGUOUS", `iThink Logistics did not return an unambiguous cancellation result for AWB '${awb}'.`, true);
    if (!success(result.status)) throw new IThinkClientError("CANCELLATION_REJECTED", text(result.remark) ?? "iThink Logistics rejected cancellation.");
  },

  async ndr(input: { awb: string; action: 1 | 2; date?: string; time?: string; phone?: string; address?: string; reason?: string }): Promise<void> {
    const payload = await post("/api_v3/ndr/add-reattempt-rto.json", { shipments: [{
      awb_numbers: input.awb, ndr_action: String(input.action), reattempt_date: input.date ?? "", reattempt_time: input.time ?? "",
      reattempt_mobile_number: input.phone ?? "", reattempt_address: input.address ?? "", reattempt_address_type: input.action === 1 ? "1" : "",
      rto_remark: input.reason ?? ""
    }] }, { mutating: true });
    const data = record(payload.data);
    const result = record(data?.[input.awb] ?? data?.["1"] ?? (Array.isArray(payload.data) ? payload.data[0] : undefined));
    if (!success(payload.status) || !success(result?.status)) throw new IThinkClientError("NDR_ACTION_REJECTED", text(result?.remark) ?? "iThink Logistics rejected the NDR action.");
  },

  // ------------------------------------------------------------------
  // Reverse (customer -> warehouse) pickup — Phase F.1. Entirely separate
  // functions from getRates()/createShipment() above (never touched) per
  // that phase's explicit "do not modify existing forward shipment flow"
  // rule — some duplication here is deliberate, not an oversight.
  //
  // Verified live against the account configured in shipping.config.ts:
  // /api_v3/rate/check.json genuinely accepts order_type: "reverse" and
  // returns only reverse-capable couriers (rev_pickup: "Y" — for this
  // account/lane, only Delhivery, matching iThink's own documented
  // "Delhivery, Bluedart, Xpressbees only" restriction for reverse). NOT
  // live-verified: an actual order/add.json booking with order_type:
  // "reverse" — doing so would dispatch a real reverse pickup against the
  // production account for no real return, so createReverseShipment() below
  // is built from iThink's documented contract only (docs.ithinklogistics.com
  // /doc-add-order/3: reverse orders use the exact same shipment-level
  // address fields as forward — "no address-swapping mechanism is
  // documented" — order_type itself is what tells iThink which direction to
  // execute pickup vs. delivery against pickup_address_id/return_address_id).
  // The first real reverse booking in production should be treated as a
  // monitored trial, not assumed correct on faith — see the Phase F.1 report.
  // ------------------------------------------------------------------

  async getReverseRates(input: { fromPincode: string; toPincode: string; lengthCm: string; widthCm: string; heightCm: string; weightKg: string; productMrp: string }): Promise<Array<{ courier: string; serviceType: string; rate: string; deliveryTat: number | null; estimatedDelivery: { min: string; max: string } | null }>> {
    const payload = await post("/api_v3/rate/check.json", {
      from_pincode: input.fromPincode,
      to_pincode: input.toPincode,
      shipping_length_cms: input.lengthCm,
      shipping_width_cms: input.widthCm,
      shipping_height_cms: input.heightCm,
      shipping_weight_kg: input.weightKg,
      order_type: "reverse",
      // Reverse shipments are prepaid-only (no COD collection on a pickup) —
      // per iThink's own documented reverse-order contract.
      payment_method: "prepaid",
      product_mrp: input.productMrp,
      delivery_type: "0"
    });
    if (!success(payload.status) || !Array.isArray(payload.data)) return [];
    const eddRecord = record(payload.edd_date);
    const minEdd = isoDate(eddRecord?.min_edd);
    const maxEdd = isoDate(eddRecord?.max_edd);
    const estimatedDelivery = minEdd && maxEdd ? { min: minEdd, max: maxEdd } : null;
    return payload.data.flatMap((value) => {
      const row = record(value);
      const courier = text(row?.logistic_name);
      const rate = text(row?.rate);
      // rev_pickup is iThink's own explicit "this courier supports reverse
      // pickup" flag (present alongside prepaid/cod/pickup on every rate
      // row) — checked in addition to the order_type: "reverse" filter the
      // endpoint itself already applies, never relied on alone.
      if (!courier || !rate || text(row?.prepaid)?.toUpperCase() !== "Y" || text(row?.pickup)?.toUpperCase() !== "Y" || text(row?.rev_pickup)?.toUpperCase() !== "Y") return [];
      return [{ courier, serviceType: text(row?.logistic_service_type) ?? "", rate, deliveryTat: positiveInt(row?.delivery_tat), estimatedDelivery }];
    });
  },

  async createReverseShipment(input: {
    shipmentNumber: string;
    shipmentDate: string;
    totalAmount: string;
    // The customer's own address — the physical pickup location for a
    // reverse shipment. Same field role forward shipments already give this
    // same address (there, it's the delivery destination) — order_type:
    // "reverse" is what flips which direction iThink executes it in.
    pickupContact: { name: string; address1: string; address2: string; pincode: string; city: string; state: string; country: string; phone: string; email: string };
    products: Array<{ name: string; sku: string; quantity: number; price: string }>;
    lengthCm: string;
    widthCm: string;
    heightCm: string;
    weightKg: string;
    logistics: string;
    serviceType: string;
  }): Promise<{ awb: string | null; reference: string | null; courier: string | null; trackingUrl: string | null }> {
    if (!shippingConfig.pickupAddressId || !shippingConfig.returnAddressId) throw new IThinkClientError("NOT_CONFIGURED", "iThink warehouse configuration is incomplete.");
    if (!shippingConfig.storeId) throw new IThinkClientError("NOT_CONFIGURED", "iThink store ID is not configured.");
    const address = input.pickupContact;
    const payload = await post("/api_v3/order/add.json", {
      shipments: [{
        waybill: "", order: input.shipmentNumber, sub_order: "", order_date: input.shipmentDate, total_amount: input.totalAmount,
        name: address.name, company_name: "", add: address.address1, add2: address.address2, add3: "", pin: address.pincode,
        city: address.city, state: address.state, country: address.country, phone: address.phone, alt_phone: "", email: address.email,
        is_billing_same_as_shipping: "yes", billing_name: address.name, billing_company_name: "", billing_add: address.address1,
        billing_add2: address.address2, billing_add3: "", billing_pin: address.pincode, billing_city: address.city,
        billing_state: address.state, billing_country: address.country, billing_phone: address.phone, billing_alt_phone: "", billing_email: address.email,
        products: input.products.map((product) => ({ product_name: product.name, product_sku: product.sku, product_quantity: String(product.quantity), product_price: product.price, product_discount: "0" })),
        shipment_length: input.lengthCm, shipment_width: input.widthCm, shipment_height: input.heightCm, weight: input.weightKg,
        shipping_charges: "0", giftwrap_charges: "0", transaction_charges: "0", total_discount: "0", first_attemp_discount: "0",
        // Reverse is always Prepaid — no COD collection on a pickup, per
        // iThink's documented reverse-order contract (never a caller input).
        cod_charges: "0", advance_amount: input.totalAmount, cod_amount: "0", payment_mode: "Prepaid",
        reseller_name: "", eway_bill_number: "", gst_number: "",
        return_address_id: shippingConfig.returnAddressId,
        store_id: shippingConfig.storeId
      }],
      pickup_address_id: shippingConfig.pickupAddressId,
      logistics: input.logistics,
      s_type: input.serviceType,
      order_type: "reverse"
    }, { create: true });
    const data = record(payload.data);
    const result = data ? record(Object.values(data)[0]) : undefined;
    if (!success(payload.status) || !result || !success(result.status)) {
      throw new IThinkClientError("CREATE_REJECTED", text(result?.remark) ?? text(payload.html_message) ?? "iThink Logistics rejected the reverse shipment.");
    }
    return { awb: text(result.waybill), reference: text(result.refnum), courier: text(result.logistic_name), trackingUrl: text(result.tracking_url) };
  }
};
