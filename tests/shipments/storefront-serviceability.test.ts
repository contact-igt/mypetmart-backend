/* eslint-disable */
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Mocked before the app (and therefore the serviceability service) is
// imported, exactly like tests/shipments/ithink-contract.test.ts. Points at
// the pre-alpha host so nothing here could ever reach the real production
// iThink account even if a `fetch` mock were somehow missed.
const mockedShippingConfig = vi.hoisted(() => ({
  provider: "ithink",
  accessToken: "test-access-token",
  secretKey: "test-secret-key",
  apiBaseUrl: "https://pre-alpha.ithinklogistics.com",
  trackingBaseUrl: "https://pre-alpha.ithinklogistics.com",
  storeId: "27377",
  pickupAddressId: "warehouse-1",
  returnAddressId: "returns-1",
  originPincode: "600077",
  timeoutMs: 1_000,
  ready: true
}));

vi.mock("../../src/config/shipping.config.js", () => ({ shippingConfig: mockedShippingConfig }));

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";

const URL = "/api/v1/storefront/delivery/check";

let categoryId: number;
let skuCounter = 0;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

// A "success" pincode/check.json response with one prepaid pickup courier.
const SERVICEABLE = { status: "success", data: { "600077": { Delhivery: { prepaid: "Y", cod: "N", pickup: "Y" } } } };
const NOT_SERVICEABLE = { status: "success", data: { "999999": {} } };
const RATE_WITH_EDD = {
  status: "success",
  edd_date: { min_edd: "2026-08-29", max_edd: "2026-09-01" },
  data: [{ logistic_name: "Delhivery", logistic_service_type: "Surface", prepaid: "Y", cod: "N", pickup: "Y", rate: "78.00", delivery_tat: "3" }]
};
const RATE_NO_EDD = {
  status: "success",
  data: [{ logistic_name: "Delhivery", logistic_service_type: "Surface", prepaid: "Y", cod: "N", pickup: "Y", rate: "78.00" }]
};

async function createProduct(overrides: Record<string, unknown> = {}): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id,
        category_id: categoryId,
        name: `Serviceability Product ${skuCounter}`,
        slug: `serviceability-product-${skuCounter}-${Date.now()}`,
        sku: `SVC-${skuCounter}-${Date.now()}`,
        description: "Serviceability test product",
        pet_type: "all",
        status: "active",
        price: "499.00",
        compare_at_price: null,
        stock: 25,
        has_variants: false,
        featured: false,
        weight_grams: 500,
        length_cm: "20.00",
        width_cm: "15.00",
        height_cm: "10.00",
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

beforeAll(async () => {
  await connectDatabase();
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      { id, name: "Serviceability Cat", slug: `svc-cat-${Date.now()}`, description: "x", pet_type: "all", active: true, display_order: 1 } as never,
      { transaction: t }
    );
  });
  categoryId = category.id;
});

afterAll(async () => {
  await disconnectDatabase();
});

beforeEach(() => {
  mockedShippingConfig.provider = "ithink";
  mockedShippingConfig.ready = true;
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("POST /storefront/delivery/check", () => {
  it("1. valid serviceable pincode + ETA available -> serviceable, real edd window, free delivery", async () => {
    const product = await createProduct();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SERVICEABLE))
      .mockResolvedValueOnce(jsonResponse(RATE_WITH_EDD));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post(URL).send({ pincode: "600077", productId: product.id });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({
      pincode: "600077",
      serviceable: true,
      estimatedDelivery: { min: "2026-08-29", max: "2026-09-01" },
      deliveryCharge: { free: true, amount: "0.00", currency: "INR" }
    });
    // pincode/check.json first, then rate/check.json — both read-only.
    const paths = fetchMock.mock.calls.map((c: any[]) => String(c[0]));
    expect(paths[0]).toContain("/api_v3/pincode/check.json");
    expect(paths[1]).toContain("/api_v3/rate/check.json");
    expect(paths.some((p: string) => p.includes("order/add"))).toBe(false);
  });

  it("2. valid non-serviceable pincode -> 200 serviceable:false, no rate call", async () => {
    const product = await createProduct();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(NOT_SERVICEABLE));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post(URL).send({ pincode: "999999", productId: product.id });

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ pincode: "999999", serviceable: false, estimatedDelivery: null, deliveryCharge: null });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("3. invalid pincode (letters / wrong length) -> 400 validation, no provider call", async () => {
    const product = await createProduct();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    for (const pincode of ["12ab56", "123", "1234567", "012345", " "]) {
      const res = await request(app).post(URL).send({ pincode, productId: product.id });
      expect(res.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("4. missing pincode -> 400 validation", async () => {
    const product = await createProduct();
    const res = await request(app).post(URL).send({ productId: product.id });
    expect(res.status).toBe(400);
  });

  it("5. provider timeout -> generic 503, never 'unavailable for this pincode'", async () => {
    const product = await createProduct();
    // IThinkClient.post() maps a thrown fetch (AbortSignal.timeout) to PROVIDER_UNAVAILABLE.
    const fetchMock = vi.fn().mockRejectedValue(new Error("The operation was aborted"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post(URL).send({ pincode: "600077", productId: product.id });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DELIVERY_CHECK_UNAVAILABLE");
    expect(res.body.error.message).toBe("Unable to check delivery right now. Please try again.");
  });

  it("6. provider-side rejection -> generic 503, no provider text leaked", async () => {
    const product = await createProduct();
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ status: "error", html_message: "Access Token Not Match." }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post(URL).send({ pincode: "600077", productId: product.id });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DELIVERY_CHECK_UNAVAILABLE");
    expect(JSON.stringify(res.body)).not.toContain("Access Token");
  });

  it("7. malformed provider response -> generic 503", async () => {
    const product = await createProduct();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response("not json", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post(URL).send({ pincode: "600077", productId: product.id });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DELIVERY_CHECK_UNAVAILABLE");
  });

  it("8. no ETA available (provider returns no edd_date) -> serviceable:true, estimatedDelivery:null", async () => {
    const product = await createProduct();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SERVICEABLE))
      .mockResolvedValueOnce(jsonResponse(RATE_NO_EDD));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post(URL).send({ pincode: "600077", productId: product.id });

    expect(res.status).toBe(200);
    expect(res.body.data.serviceable).toBe(true);
    expect(res.body.data.estimatedDelivery).toBeNull();
    expect(res.body.data.deliveryCharge).toEqual({ free: true, amount: "0.00", currency: "INR" });
  });

  it("9. product without package dimensions -> serviceable answer, rate/check.json never called", async () => {
    const product = await createProduct({ weight_grams: null, length_cm: null, width_cm: null, height_cm: null });
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse(SERVICEABLE));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post(URL).send({ pincode: "600077", productId: product.id });

    expect(res.status).toBe(200);
    expect(res.body.data.serviceable).toBe(true);
    expect(res.body.data.estimatedDelivery).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("10. unknown / inactive product -> 404, no provider call", async () => {
    const inactive = await createProduct({ status: "draft" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const missing = await request(app).post(URL).send({ pincode: "600077", productId: 99999999 });
    expect(missing.status).toBe(404);

    const draft = await request(app).post(URL).send({ pincode: "600077", productId: inactive.id });
    expect(draft.status).toBe(404);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("11. provider not configured -> generic 503 (not a serviceability claim)", async () => {
    mockedShippingConfig.ready = false;
    const product = await createProduct();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post(URL).send({ pincode: "600077", productId: product.id });

    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe("DELIVERY_CHECK_UNAVAILABLE");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("12. no Order / Shipment is ever created by a check", async () => {
    const product = await createProduct();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SERVICEABLE))
      .mockResolvedValueOnce(jsonResponse(RATE_WITH_EDD));
    vi.stubGlobal("fetch", fetchMock);

    const [ordersBefore, shipmentsBefore] = await Promise.all([
      sequelize.query("SELECT COUNT(*) AS n FROM orders"),
      sequelize.query("SELECT COUNT(*) AS n FROM shipments")
    ]);
    await request(app).post(URL).send({ pincode: "600077", productId: product.id });
    const [ordersAfter, shipmentsAfter] = await Promise.all([
      sequelize.query("SELECT COUNT(*) AS n FROM orders"),
      sequelize.query("SELECT COUNT(*) AS n FROM shipments")
    ]);

    expect((ordersAfter[0] as any)[0].n).toBe((ordersBefore[0] as any)[0].n);
    expect((shipmentsAfter[0] as any)[0].n).toBe((shipmentsBefore[0] as any)[0].n);
    // Only ever the two read-only endpoints.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).toMatch(/\/api_v3\/(pincode|rate)\/check\.json$/u);
    }
  });

  it("13. variant quantity is reflected in the rated weight, not exposed to the customer", async () => {
    const product = await createProduct({ has_variants: true, price: "0.00", stock: 0 });
    const variant = await sequelize.transaction(async (t) => {
      const id = await IdSequenceService.allocateNextId("product_variants", t);
      return ProductVariant.create(
        { id, product_id: product.id, name: "1kg", sku: `SVC-VAR-${id}`, price: "699.00", compare_at_price: null, stock: 10, active: true, display_order: 0, weight_grams: 1000, length_cm: "25.00", width_cm: "18.00", height_cm: "12.00" } as never,
        { transaction: t }
      );
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(SERVICEABLE))
      .mockResolvedValueOnce(jsonResponse(RATE_WITH_EDD));
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(app).post(URL).send({ pincode: "600077", productId: product.id, variantId: variant.id, quantity: 3 });

    expect(res.status).toBe(200);
    const rateBody = JSON.parse((fetchMock.mock.calls[1] as any[])[1].body).data;
    expect(rateBody.shipping_weight_kg).toBe("3.000");
    expect(rateBody.shipping_height_cms).toBe("36.00");
    // customer-facing payload carries no courier name / raw rate
    expect(JSON.stringify(res.body)).not.toMatch(/Delhivery/i);
    expect(JSON.stringify(res.body)).not.toContain("78.00");
  });
});
