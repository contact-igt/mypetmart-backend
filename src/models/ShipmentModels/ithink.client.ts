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
};

export type IThinkTrackingEvent = { status: string; statusCode: string | null; location: string | null; message: string | null; eventAt: string };
export type IThinkTrackingResult = { awb: string; courier: string | null; currentStatus: string; currentStatusCode: string | null; events: IThinkTrackingEvent[] };

export class IThinkClientError extends Error {
  public constructor(public readonly code: string, message: string, public readonly uncertain = false) { super(message); this.name = "IThinkClientError"; }
}

function record(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : undefined;
}
function text(value: unknown): string | null { return typeof value === "string" || typeof value === "number" ? String(value) : null; }
function success(value: unknown): boolean { return text(value)?.toLowerCase() === "success"; }

function credentials(): { access_token: string; secret_key: string } {
  if (!shippingConfig.accessToken || !shippingConfig.secretKey) throw new IThinkClientError("NOT_CONFIGURED", "iThink credentials are not configured.");
  return { access_token: shippingConfig.accessToken, secret_key: shippingConfig.secretKey };
}

async function post(path: string, data: JsonRecord, options: { tracking?: boolean; create?: boolean; mutating?: boolean } = {}): Promise<JsonRecord> {
  const baseUrl = options.tracking ? shippingConfig.trackingBaseUrl : shippingConfig.apiBaseUrl;
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
  if (!response.ok) throw new IThinkClientError("PROVIDER_UNAVAILABLE", `iThink Logistics returned HTTP ${response.status}.`, false);
  const payload = record(await response.json().catch(() => undefined));
  if (!payload) throw new IThinkClientError("INVALID_RESPONSE", "iThink Logistics returned an invalid response.", Boolean(options.create));
  return payload;
}

export const IThinkClient = {
  async checkServiceability(pincode: string): Promise<string[]> {
    const payload = await post("/api_v3/pincode/check.json", { pincode });
    if (!success(payload.status)) throw new IThinkClientError("SERVICEABILITY_CHECK_FAILED", text(payload.html_message) ?? text(payload.message) ?? "iThink Logistics rejected the pincode check.");
    const courierMap = record(record(payload.data)?.[pincode]);
    if (!courierMap) return [];
    return Object.entries(courierMap)
      .filter(([, details]) => { const row = record(details); return text(row?.prepaid)?.toUpperCase() === "Y" && text(row?.pickup)?.toUpperCase() === "Y"; })
      .map(([name]) => name.toLowerCase());
  },

  async getRates(input: { toPincode: string; lengthCm: string; widthCm: string; heightCm: string; weightKg: string; productMrp: string }): Promise<Array<{ courier: string; serviceType: string; rate: string }>> {
    if (!shippingConfig.originPincode) throw new IThinkClientError("NOT_CONFIGURED", "Origin pincode is not configured.");
    const payload = await post("/api_v3/rate/check.json", {
      from_pincode: shippingConfig.originPincode,
      to_pincode: input.toPincode,
      shipping_length_cms: input.lengthCm,
      shipping_width_cms: input.widthCm,
      shipping_height_cms: input.heightCm,
      shipping_weight_kg: input.weightKg,
      order_type: "forward",
      payment_method: "prepaid",
      product_mrp: input.productMrp,
      delivery_type: "0"
    });
    if (!success(payload.status) || !Array.isArray(payload.data)) return [];
    return payload.data.flatMap((value) => {
      const row = record(value);
      const courier = text(row?.logistic_name);
      const rate = text(row?.rate);
      if (!courier || !rate || text(row?.prepaid)?.toUpperCase() !== "Y" || text(row?.pickup)?.toUpperCase() !== "Y") return [];
      return [{ courier, serviceType: text(row?.logistic_service_type) ?? "", rate }];
    });
  },

  async createShipment(input: IThinkPackageInput): Promise<{ awb: string | null; reference: string | null; courier: string | null; trackingUrl: string | null }> {
    if (!shippingConfig.pickupAddressId || !shippingConfig.returnAddressId) throw new IThinkClientError("NOT_CONFIGURED", "iThink warehouse configuration is incomplete.");
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
        cod_charges: "0", advance_amount: input.totalAmount, cod_amount: "0", payment_mode: "Prepaid", reseller_name: "", eway_bill_number: "", gst_number: "",
        return_address_id: shippingConfig.returnAddressId
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
    const result = record(record(payload.data)?.[awb]);
    if (!result || text(result.message)?.toLowerCase() !== "success") throw new IThinkClientError("TRACKING_UNAVAILABLE", "Tracking is not currently available for this AWB.");
    const events = Array.isArray(result.scan_details) ? result.scan_details.flatMap((value) => {
      const row = record(value); const status = text(row?.status); const eventAt = text(row?.scan_date_time);
      if (!status || !eventAt) return [];
      return [{ status, statusCode: text(row?.status_code), location: text(row?.scan_location), message: text(row?.status_reason) ?? text(row?.remark), eventAt }];
    }) : [];
    return { awb: text(result.awb_no) ?? awb, courier: text(result.logistic), currentStatus: text(result.current_status) ?? "Unknown", currentStatusCode: text(result.current_status_code), events };
  },

  async cancel(awb: string): Promise<void> {
    const payload = await post("/api_v3/order/cancel.json", { awb_numbers: awb }, { mutating: true });
    const result = record(record(payload.data)?.["1"] ?? (Array.isArray(payload.data) ? payload.data[0] : undefined));
    if (!success(payload.status) || !success(result?.status)) throw new IThinkClientError("CANCELLATION_REJECTED", text(result?.remark) ?? "iThink Logistics rejected cancellation.");
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
  }
};
