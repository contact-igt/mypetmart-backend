/* eslint-disable */
import crypto from "node:crypto";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import type { CartJSON } from "../../src/models/CartModels/cart.types.js";
import { buildBreezeCartObject } from "../../src/models/PaymentModels/breeze-cart-builder.js";

const CHECKOUT_SESSION_URL = "/api/v1/storefront/payments/breeze/checkout-session";

function cartWith(items: Array<{ price: string; quantity: number; variantName?: string | null }>): CartJSON {
  return {
    id: 1,
    status: "active",
    itemCount: items.length,
    subtotal: "0.00",
    coupon: null,
    items: items.map((item, index) => ({
      cartItemId: index + 1,
      productId: 10 + index,
      categoryId: 1,
      paymentMethodEligibility: "both",
      variantId: item.variantName ? 100 + index : null,
      productName: `Product ${index + 1}`,
      productSlug: `product-${index + 1}`,
      productType: item.variantName ? "variant" : "simple",
      sku: `SKU-${index + 1}`,
      variantName: item.variantName ?? null,
      image: null,
      price: item.price,
      compareAtPrice: null,
      quantity: item.quantity,
      subtotal: "0.00",
      available: true,
      availabilityReason: null,
      availableQuantity: 99
    }))
  };
}

describe("buildBreezeCartObject", () => {
  it("derives server totals in integer paise from cart prices and quantities", () => {
    const cart = buildBreezeCartObject(cartWith([{ price: "499.50", quantity: 2 }, { price: "10.00", quantity: 1, variantName: "Large" }]), "sess_1");
    expect(cart.id).toBe("sess_1");
    expect(cart.totalPrice).toBe(99900 + 1000);
    expect(cart.initialPrice).toBe(cart.totalPrice);
    expect(cart.totalDiscount).toBe(0);
    expect(cart.itemCount).toBe(3);
    expect(cart.currency).toBe("INR");
    expect(cart.items[0]).toMatchObject({ id: "1", quantity: 2, initialPrice: 49950, finalPrice: 49950, discount: 0 });
    expect(cart.items[1]).toMatchObject({ variantTitle: "Large", variantId: "101" });
    expect(Number.isInteger(cart.totalPrice)).toBe(true);
  });

  it("never emits an undefined/extra key that would change the signed string", () => {
    const cart = buildBreezeCartObject(cartWith([{ price: "1.00", quantity: 1 }]), "s");
    expect(Object.keys(cart.items[0]!)).not.toContain("variantTitle");
    expect(JSON.stringify(cart)).not.toContain("undefined");
  });
});

describe("Breeze checkout-session route — feature flag OFF (default)", () => {
  let app: typeof import("../../src/app.js").app;
  let sequelize: typeof import("../../src/database/index.js").sequelize;

  beforeAll(async () => {
    const database = await import("../../src/database/index.js");
    await database.connectDatabase();
    sequelize = database.sequelize;
    app = (await import("../../src/app.js")).app;
  });

  afterAll(async () => {
    const database = await import("../../src/database/index.js");
    await database.disconnectDatabase();
  });

  it("is hidden (404 BREEZE_CHECKOUT_UNAVAILABLE) unless BREEZE_1CCO_ENABLED is true", async () => {
    const response = await request(app).post(CHECKOUT_SESSION_URL).send({});
    expect(response.status).toBe(404);
    expect(JSON.stringify(response.body)).toContain("BREEZE_CHECKOUT_UNAVAILABLE");
    // No secret material of any kind in the response.
    expect(JSON.stringify(response.body)).not.toMatch(/PRIVATE KEY|signature/iu);
  });

  it("does not create any session row while disabled", async () => {
    const [rows] = await sequelize.query("SELECT COUNT(*) AS n FROM breeze_checkout_sessions");
    expect((rows as Array<{ n: number }>)[0]!.n).toBe(0);
  });
});

void crypto;
void vi;
