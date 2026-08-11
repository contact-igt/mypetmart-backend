/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { Cart } from "../../src/database/tables/CartTable/index.js";
import { CartItem } from "../../src/database/tables/CartItemTable/index.js";
import { Address } from "../../src/database/tables/AddressTable/index.js";
import { Payment } from "../../src/database/tables/PaymentTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

const CART_URL = "/api/v1/storefront/cart";
const ADDRESS_URL = "/api/v1/storefront/addresses";
const CHECKOUT_URL = "/api/v1/storefront/checkout/preview";

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      {
        id,
        name: "Checkout Test Category",
        slug: `checkout-test-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: "Category for Checkout backend tests",
        pet_type: "all",
        active: true,
        display_order: 1
      },
      { transaction: t }
    );
  });
  return category.id;
}

async function createSimpleProduct(overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id,
        category_id: categoryId,
        name: `Checkout Test Simple Product ${skuCounter}`,
        slug: `checkout-test-simple-${skuCounter}-${Date.now()}`,
        sku: `CHK-SIMPLE-${skuCounter}-${Date.now()}`,
        description: "Simple product for Checkout tests",
        pet_type: "all",
        status: "active",
        price: "499.00",
        compare_at_price: null,
        stock: 50,
        has_variants: false,
        featured: false,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

async function createVariantProduct(overrides: Partial<Record<string, unknown>> = {}): Promise<Product> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("products", t);
    return Product.create(
      {
        id,
        category_id: categoryId,
        name: `Checkout Test Variant Product ${skuCounter}`,
        slug: `checkout-test-variant-product-${skuCounter}-${Date.now()}`,
        sku: `CHK-VARPROD-${skuCounter}-${Date.now()}`,
        description: "Variant product for Checkout tests",
        pet_type: "all",
        status: "active",
        price: "0.00",
        compare_at_price: null,
        stock: 0,
        has_variants: true,
        featured: false,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

async function createVariant(productId: number, overrides: Partial<Record<string, unknown>> = {}): Promise<ProductVariant> {
  skuCounter += 1;
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("product_variants", t);
    return ProductVariant.create(
      {
        id,
        product_id: productId,
        name: `Variant ${skuCounter}`,
        sku: `CHK-VAR-${skuCounter}-${Date.now()}`,
        price: "299.00",
        compare_at_price: null,
        stock: 20,
        active: true,
        display_order: 0,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

function validAddressPayload(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    recipientName: "Jordan Rivera",
    phone: "+91 98765 43210",
    line1: "221B Baker Street",
    city: "Mumbai",
    state: "Maharashtra",
    postalCode: "400001",
    ...overrides
  };
}

async function mintCustomerToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const user = await User.create({
    id,
    name: `Checkout Test Customer ${id}`,
    email,
    password_hash: pwdHash,
    role: "customer",
    status: "active",
    reference_code: `CUS-${id}`
  });
  const { session } = await SessionService.createSession(user.id, "customer", null, null);
  return TokenService.generateAccessToken({
    sub: String(user.id),
    sessionId: String(session.id),
    role: "customer",
    sessionType: "customer"
  });
}

describe("Checkout Preview Backend Integration Tests", () => {
  let customerAToken: string;
  let customerBToken: string;

  beforeAll(async () => {
    await connectDatabase();

    for (const id of [99501, 99502]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }

    customerAToken = await mintCustomerToken(99501, "checkout-test-customer-a@example.com");
    customerBToken = await mintCustomerToken(99502, "checkout-test-customer-b@example.com");
  });

  afterAll(async () => {
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: [99501, 99502] }, force: true });
    await User.destroy({ where: { id: [99501, 99502] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await Address.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    categoryId = await createCategory();
  });

  // ---------------------------------------------------------------------
  // Authenticated
  // ---------------------------------------------------------------------
  describe("Authenticated Checkout", () => {
    it("previews a valid customer cart with an owned saved address", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 2 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.status).toBe(200);
      expect(res.body.data.readiness.cartReady).toBe(true);
      expect(res.body.data.readiness.addressReady).toBe(true);
      expect(res.body.data.readiness.orderReady).toBe(false);
      expect(res.body.data.shippingAddress.city).toBe("Mumbai");
    });

    it("rejects another customer's savedAddressId", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const bAddress = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerBToken}`).send(validAddressPayload());

      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: bAddress.body.data.id });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("CHECKOUT_ADDRESS_NOT_FOUND");
    });

    it("rejects checkout preview with an empty cart", async () => {
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("CHECKOUT_CART_EMPTY");
    });
  });

  // ---------------------------------------------------------------------
  // Guest
  // ---------------------------------------------------------------------
  describe("Guest Checkout", () => {
    it("previews a valid guest cart with an inline address", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = request.agent(app);
      await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });

      const res = await guest.post(CHECKOUT_URL).send({ shippingAddress: validAddressPayload() });
      expect(res.status).toBe(200);
      expect(res.body.data.readiness.cartReady).toBe(true);
      expect(res.body.data.shippingAddress.recipientName).toBe("Jordan Rivera");
    });

    it("ignores any savedAddressId a guest supplies and still requires an inline address", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const savedByCustomer = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      const guest = request.agent(app);
      await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });

      const res = await guest.post(CHECKOUT_URL).send({ savedAddressId: savedByCustomer.body.data.id });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CHECKOUT_ADDRESS_REQUIRED");
    });
  });

  // ---------------------------------------------------------------------
  // Product lifecycle
  // ---------------------------------------------------------------------
  describe("Product Lifecycle Integration", () => {
    async function addThenTransition(transition: (product: Product) => Promise<void>) {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      await transition(product);
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      return request(app).post(CHECKOUT_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
    }

    it("blocks checkout when the Product becomes Draft", async () => {
      const res = await addThenTransition(async (p) => {
        p.status = "draft";
        await p.save();
      });
      expect(res.status).toBe(200);
      expect(res.body.data.readiness.cartReady).toBe(false);
      expect(res.body.data.cart.items[0].availabilityReason).toBe("PRODUCT_UNAVAILABLE");
    });

    it("blocks checkout when the Product becomes Archived", async () => {
      const res = await addThenTransition(async (p) => {
        p.status = "archived";
        await p.save();
      });
      expect(res.body.data.readiness.cartReady).toBe(false);
    });

    it("blocks checkout when the Product is deleted", async () => {
      const res = await addThenTransition(async (p) => {
        await p.destroy();
      });
      expect(res.body.data.readiness.cartReady).toBe(false);
      expect(res.body.data.cart.items[0].availabilityReason).toBe("PRODUCT_UNAVAILABLE");
    });

    it("blocks checkout for a Product restored to Draft", async () => {
      const res = await addThenTransition(async (p) => {
        await p.destroy();
        await p.restore();
        p.status = "draft";
        await p.save();
      });
      expect(res.body.data.readiness.cartReady).toBe(false);
    });

    it("allows checkout for a normally sellable Active Product", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });
      expect(res.body.data.readiness.cartReady).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Variant lifecycle
  // ---------------------------------------------------------------------
  describe("Variant Lifecycle Integration", () => {
    it("blocks checkout when the Variant becomes inactive", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { stock: 10 });
      await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, variantId: variant.id, quantity: 1 });

      variant.active = false;
      await variant.save();

      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.body.data.readiness.cartReady).toBe(false);
      expect(res.body.data.cart.items[0].availabilityReason).toBe("VARIANT_UNAVAILABLE");
    });

    it("blocks checkout when the Variant is deleted", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { stock: 10 });
      await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, variantId: variant.id, quantity: 1 });

      await variant.destroy();

      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.body.data.readiness.cartReady).toBe(false);
    });

    it("never lets a Variant/Product mismatch enter the cart in the first place, so checkout stays clean", async () => {
      const productOne = await createVariantProduct();
      const productTwo = await createVariantProduct();
      const foreignVariant = await createVariant(productTwo.id, { stock: 10 });

      const rejectedAdd = await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: productOne.id, variantId: foreignVariant.id, quantity: 1 });
      expect(rejectedAdd.status).toBe(400);

      const validVariant = await createVariant(productOne.id, { stock: 10 });
      await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: productOne.id, variantId: validVariant.id, quantity: 1 });

      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.body.data.cart.items).toHaveLength(1);
      expect(res.body.data.readiness.cartReady).toBe(true);
    });
  });

  // ---------------------------------------------------------------------
  // Stock
  // ---------------------------------------------------------------------
  describe("Stock Revalidation", () => {
    it("blocks checkout when Simple Product stock becomes insufficient", async () => {
      const product = await createSimpleProduct({ stock: 5 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 5 });

      product.stock = 2;
      await product.save();

      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.body.data.readiness.cartReady).toBe(false);
      expect(res.body.data.cart.items[0]).toMatchObject({ availabilityReason: "OUT_OF_STOCK", availableQuantity: 2 });
    });

    it("blocks checkout when Variant stock becomes insufficient", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { stock: 5 });
      await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, variantId: variant.id, quantity: 5 });

      variant.stock = 1;
      await variant.save();

      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.body.data.readiness.cartReady).toBe(false);
      expect(res.body.data.cart.items[0].availableQuantity).toBe(1);
    });

    it("allows checkout when the requested quantity is within current stock", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 3 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });
      expect(res.body.data.readiness.cartReady).toBe(true);
    });

    it("does not reserve or decrement stock when previewing checkout", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 3 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      await request(app).post(CHECKOUT_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      const reloaded = await Product.findByPk(product.id);
      expect(reloaded?.stock).toBe(10);
    });
  });

  // ---------------------------------------------------------------------
  // Price authority
  // ---------------------------------------------------------------------
  describe("Price Authority", () => {
    it("uses the current Product price, not the price at add time", async () => {
      const product = await createSimpleProduct({ price: "499.00", stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });

      product.price = "599.00";
      await product.save();

      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.body.data.cart.items[0].price).toBe("599.00");
      expect(res.body.data.totals.merchandiseSubtotal).toBe("599.00");
    });

    it("uses the current Variant price, not the price at add time", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { price: "299.00", stock: 10 });
      await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, variantId: variant.id, quantity: 1 });

      variant.price = "349.00";
      await variant.save();

      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.body.data.cart.items[0].price).toBe("349.00");
    });

    it("computes an exact decimal merchandise subtotal", async () => {
      const product = await createSimpleProduct({ price: "19.99", stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 3 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.body.data.totals.merchandiseSubtotal).toBe("59.97");
      expect(res.body.data.totals.shippingAmount).toBeNull();
      expect(res.body.data.totals.payableTotal).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // Side effects
  // ---------------------------------------------------------------------
  describe("Side-Effect Safety", () => {
    it("does not create an Order, does not call PayU, and does not call iThink Logistics", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      await request(app).post(CHECKOUT_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      // No Orders/Payments module exists yet in this stage, so the only verifiable
      // guarantee is that Checkout never touches the (already-existing) payments table.
      expect(await Payment.count()).toBe(0);
    });

    it("does not alter the Cart", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 2 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());
      await request(app).post(CHECKOUT_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      const cart = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(cart.body.data.items).toHaveLength(1);
      expect(cart.body.data.items[0].quantity).toBe(2);
    });

    it("is idempotent when called repeatedly", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app).post(ADDRESS_URL).set("Authorization", `Bearer ${customerAToken}`).send(validAddressPayload());

      const first = await request(app).post(CHECKOUT_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });
      const second = await request(app).post(CHECKOUT_URL).set("Authorization", `Bearer ${customerAToken}`).send({ savedAddressId: address.body.data.id });

      expect(first.body.data).toEqual(second.body.data);
    });
  });

  // ---------------------------------------------------------------------
  // Address handling
  // ---------------------------------------------------------------------
  describe("Checkout Address Handling", () => {
    it("normalizes an inline guest address, defaulting country", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = request.agent(app);
      await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });

      const res = await guest.post(CHECKOUT_URL).send({ shippingAddress: validAddressPayload({ line1: "  221B Baker Street  " }) });
      expect(res.body.data.shippingAddress.country).toBe("IN");
      expect(res.body.data.shippingAddress.line1).toBe("221B Baker Street");
    });

    it("rejects an invalid inline address", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = request.agent(app);
      await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });

      const res = await guest.post(CHECKOUT_URL).send({ shippingAddress: validAddressPayload({ recipientName: "", phone: "###" }) });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUTH_VALIDATION_FAILED");
    });

    it("returns a saved authenticated address as a normalized checkout candidate", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const address = await request(app)
        .post(ADDRESS_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send(validAddressPayload({ line2: "Suite 4" }));

      const res = await request(app)
        .post(CHECKOUT_URL)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ savedAddressId: address.body.data.id });

      expect(res.body.data.shippingAddress).toMatchObject({
        recipientName: "Jordan Rivera",
        line1: "221B Baker Street",
        line2: "Suite 4",
        city: "Mumbai",
        country: "IN"
      });
      expect(res.body.data.billingAddress).toEqual(res.body.data.shippingAddress);
      expect(res.body.data.billingSameAsShipping).toBe(true);
    });
  });
});
