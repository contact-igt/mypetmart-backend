/* eslint-disable */
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { app } from "../../src/app.js";
import { Category } from "../../src/database/tables/CategoryTable/index.js";
import { Product } from "../../src/database/tables/ProductTable/index.js";
import { ProductFeature } from "../../src/database/tables/ProductFeatureTable/index.js";
import { ProductMediaAssignment } from "../../src/database/tables/ProductMediaAssignmentTable/index.js";
import { ProductVariant } from "../../src/database/tables/ProductVariantTable/index.js";
import { ProductImage } from "../../src/database/tables/ProductImageTable/index.js";
import { Cart } from "../../src/database/tables/CartTable/index.js";
import { CartItem } from "../../src/database/tables/CartItemTable/index.js";
import { User } from "../../src/database/tables/UserTable/index.js";
import { AuthSession } from "../../src/database/tables/AuthSessionTable/index.js";
import { IdSequenceService } from "../../src/database/sequences/id-sequence.service.js";
import { connectDatabase, disconnectDatabase, sequelize } from "../../src/database/index.js";
import { PasswordService } from "../../src/services/auth/password.service.js";
import { SessionService } from "../../src/services/auth/session.service.js";
import { TokenService } from "../../src/services/auth/token.service.js";

const CART_URL = "/api/v1/storefront/cart";

let categoryId: number;
let skuCounter = 0;

async function createCategory(): Promise<number> {
  const category = await sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("categories", t);
    return Category.create(
      {
        id,
        name: "Cart Test Category",
        slug: `cart-test-category-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        description: "Category for Cart backend tests",
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
        name: `Cart Test Simple Product ${skuCounter}`,
        slug: `cart-test-simple-${skuCounter}-${Date.now()}`,
        sku: `CART-SIMPLE-${skuCounter}-${Date.now()}`,
        description: "Simple product for Cart tests",
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
        name: `Cart Test Variant Product ${skuCounter}`,
        slug: `cart-test-variant-product-${skuCounter}-${Date.now()}`,
        sku: `CART-VARPROD-${skuCounter}-${Date.now()}`,
        description: "Variant product for Cart tests",
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
        sku: `CART-VAR-${skuCounter}-${Date.now()}`,
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

async function createImage(productId: number, overrides: Partial<Record<string, unknown>> = {}): Promise<ProductImage> {
  return sequelize.transaction(async (t) => {
    const id = await IdSequenceService.allocateNextId("product_images", t);
    return ProductImage.create(
      {
        id,
        product_id: productId,
        r2_key: `test/${id}.jpg`,
        url: `https://cdn.example.test/${id}.jpg`,
        alt: `Test image ${id}`,
        content_type: "image/jpeg",
        size_bytes: 1024,
        width: 800,
        height: 800,
        sort_order: 0,
        is_primary: false,
        ...overrides
      } as never,
      { transaction: t }
    );
  });
}

async function mintCustomerToken(id: number, email: string): Promise<string> {
  const pwdHash = await PasswordService.hash("TestPass123!@#");
  const user = await User.create({
    id,
    name: `Cart Test Customer ${id}`,
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

describe("Cart Backend Integration Tests", () => {
  let customerAToken: string;
  let customerBToken: string;

  beforeAll(async () => {
    await connectDatabase();

    for (const id of [99301, 99302]) {
      const existing = await User.findOne({ where: { id }, paranoid: false });
      if (existing) {
        await AuthSession.destroy({ where: { user_id: existing.id }, force: true });
        await User.destroy({ where: { id: existing.id }, force: true });
      }
    }

    customerAToken = await mintCustomerToken(99301, "cart-test-customer-a@example.com");
    customerBToken = await mintCustomerToken(99302, "cart-test-customer-b@example.com");
  });

  afterAll(async () => {
    // Other test files' beforeEach hard-deletes Products without touching cart_items;
    // leaving rows behind here would trip their FK (RESTRICT) cleanup when this file
    // runs earlier in suite order. Mirror the beforeEach wipe before disconnecting.
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    await AuthSession.destroy({ where: { user_id: [99301, 99302] }, force: true });
    await User.destroy({ where: { id: [99301, 99302] }, force: true });
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await CartItem.destroy({ where: {}, truncate: false, force: true });
    await Cart.destroy({ where: {}, truncate: false, force: true });
    await ProductImage.destroy({ where: {}, truncate: false, force: true });
    await ProductVariant.destroy({ where: {}, truncate: false, force: true });
    await ProductFeature.destroy({ where: {}, truncate: false, force: true });
    await ProductMediaAssignment.destroy({ where: {}, truncate: false, force: true });
    await Product.destroy({ where: {}, truncate: false, force: true });
    await Category.destroy({ where: {}, truncate: false, force: true });
    categoryId = await createCategory();
  });

  // ---------------------------------------------------------------------
  // Authenticated Cart
  // ---------------------------------------------------------------------
  describe("Authenticated Customer Cart", () => {
    it("returns an empty virtual cart when none exists yet", async () => {
      const res = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({ id: null, itemCount: 0, subtotal: "0.00", items: [] });
    });

    it("adds a simple product to the cart", async () => {
      const product = await createSimpleProduct({ price: "499.00", stock: 10 });
      const res = await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, quantity: 2 });

      expect(res.status).toBe(201);
      expect(res.body.data.itemCount).toBe(2);
      expect(res.body.data.subtotal).toBe("998.00");
      expect(res.body.data.items[0]).toMatchObject({
        productId: product.id,
        variantId: null,
        productType: "simple",
        quantity: 2,
        price: "499.00",
        subtotal: "998.00",
        available: true
      });
    });

    it("combines quantity when the same simple product is added again", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 2 });
      const res = await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, quantity: 1 });

      expect(res.status).toBe(201);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(3);
    });

    it("updates the quantity of an existing cart item", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const addRes = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const cartItemId = addRes.body.data.items[0].cartItemId;

      const res = await request(app)
        .patch(`${CART_URL}/items/${cartItemId}`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ quantity: 5 });

      expect(res.status).toBe(200);
      expect(res.body.data.items[0].quantity).toBe(5);
    });

    it("removes a cart item", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const addRes = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const cartItemId = addRes.body.data.items[0].cartItemId;

      const res = await request(app).delete(`${CART_URL}/items/${cartItemId}`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });

    it("clears the cart", async () => {
      const productOne = await createSimpleProduct({ stock: 10 });
      const productTwo = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: productOne.id, quantity: 1 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: productTwo.id, quantity: 1 });

      const res = await request(app).delete(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.status).toBe(200);
      expect(res.body.data.items).toHaveLength(0);
    });

    it("isolates carts between two authenticated customers and blocks cross-customer mutation", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const addRes = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const cartItemId = addRes.body.data.items[0].cartItemId;

      const bCart = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerBToken}`);
      expect(bCart.body.data.items).toHaveLength(0);

      const forbidden = await request(app)
        .patch(`${CART_URL}/items/${cartItemId}`)
        .set("Authorization", `Bearer ${customerBToken}`)
        .send({ quantity: 2 });
      expect(forbidden.status).toBe(404);
      expect(forbidden.body.error.code).toBe("CART_ITEM_NOT_FOUND");
    });
  });

  // ---------------------------------------------------------------------
  // Variant Cart
  // ---------------------------------------------------------------------
  describe("Variant Cart", () => {
    it("adds a variant product with a selected variant", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { price: "299.00", stock: 5 });

      const res = await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, variantId: variant.id, quantity: 2 });

      expect(res.status).toBe(201);
      expect(res.body.data.items[0]).toMatchObject({
        productId: product.id,
        variantId: variant.id,
        productType: "variant",
        price: "299.00",
        quantity: 2
      });
    });

    it("combines quantity when the same variant is added again", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, variantId: variant.id, quantity: 2 });
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, variantId: variant.id, quantity: 1 });

      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0].quantity).toBe(3);
    });

    it("creates a separate line for a different variant of the same product", async () => {
      const product = await createVariantProduct();
      const variantOne = await createVariant(product.id, { name: "Small", stock: 10 });
      const variantTwo = await createVariant(product.id, { name: "Large", stock: 10 });

      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, variantId: variantOne.id, quantity: 1 });
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, variantId: variantTwo.id, quantity: 1 });

      expect(res.body.data.items).toHaveLength(2);
    });

    it("rejects a variant that belongs to a different product", async () => {
      const productOne = await createVariantProduct();
      const productTwo = await createVariantProduct();
      const foreignVariant = await createVariant(productTwo.id, { stock: 10 });

      const res = await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: productOne.id, variantId: foreignVariant.id, quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CART_VARIANT_MISMATCH");
    });

    it("rejects adding a variant product without selecting a variant", async () => {
      const product = await createVariantProduct();
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CART_VARIANT_REQUIRED");
    });

    it("rejects adding a simple product with a variantId", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const otherProduct = await createVariantProduct();
      const variant = await createVariant(otherProduct.id, { stock: 10 });

      const res = await request(app)
        .post(`${CART_URL}/items`)
        .set("Authorization", `Bearer ${customerAToken}`)
        .send({ productId: product.id, variantId: variant.id, quantity: 1 });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CART_VARIANT_NOT_ALLOWED");
    });
  });

  // ---------------------------------------------------------------------
  // Quantity / Stock
  // ---------------------------------------------------------------------
  describe("Quantity and Stock Validation", () => {
    it.each([
      ["zero", 0],
      ["negative", -1],
      ["decimal", 1.5],
      ["over the maximum", 21]
    ])("rejects a %s quantity on add", async (_label, quantity) => {
      const product = await createSimpleProduct({ stock: 50 });
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("AUTH_VALIDATION_FAILED");
    });

    it("rejects an add that exceeds available stock", async () => {
      const product = await createSimpleProduct({ stock: 3 });
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 5 });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("CART_INSUFFICIENT_STOCK");
      expect(res.body.error.details).toEqual({ availableQuantity: 3 });
    });

    it("rejects adding a product with zero stock", async () => {
      const product = await createSimpleProduct({ stock: 0 });
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("CART_INSUFFICIENT_STOCK");
      expect(res.body.error.details).toEqual({ availableQuantity: 0 });
    });

    it("rejects a combined add that exceeds the per-line quantity cap, reporting the real cap in error.details", async () => {
      const product = await createSimpleProduct({ stock: 50 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 15 });

      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 10 });

      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("CART_QUANTITY_LIMIT_EXCEEDED");
      expect(res.body.error.details).toEqual({ max: 20 });
    });

    it("does not include a details field on errors that carry no structured domain data", async () => {
      const product = await createSimpleProduct();
      await product.destroy();
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
      expect(res.body.error).not.toHaveProperty("details");
    });
  });

  // ---------------------------------------------------------------------
  // Catalog lifecycle
  // ---------------------------------------------------------------------
  describe("Catalog Lifecycle Integration", () => {
    it("rejects adding a draft product", async () => {
      const product = await createSimpleProduct({ status: "draft" });
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("CART_PRODUCT_NOT_AVAILABLE");
    });

    it("rejects adding an archived product", async () => {
      const product = await createSimpleProduct({ status: "archived" });
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe("CART_PRODUCT_NOT_AVAILABLE");
    });

    it("rejects adding a deleted product", async () => {
      const product = await createSimpleProduct();
      await product.destroy();
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe("PRODUCT_NOT_FOUND");
    });

    it("rejects adding an inactive or deleted variant", async () => {
      const product = await createVariantProduct();
      const inactiveVariant = await createVariant(product.id, { active: false });
      const inactiveRes = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, variantId: inactiveVariant.id, quantity: 1 });
      expect(inactiveRes.status).toBe(422);
      expect(inactiveRes.body.error.code).toBe("CART_VARIANT_NOT_AVAILABLE");

      const deletedVariant = await createVariant(product.id);
      await deletedVariant.destroy();
      const deletedRes = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, variantId: deletedVariant.id, quantity: 1 });
      expect(deletedRes.status).toBe(404);
      expect(deletedRes.body.error.code).toBe("PRODUCT_VARIANT_NOT_FOUND");
    });

    it("reports a cart line as unavailable after its product becomes archived, without deleting it", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 2 });

      product.status = "archived";
      await product.save();

      const res = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({ available: false, availabilityReason: "PRODUCT_UNAVAILABLE", availableQuantity: 0 });
    });

    it("reports a cart line as unavailable after its variant becomes inactive, without deleting it", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, variantId: variant.id, quantity: 2 });

      variant.active = false;
      await variant.save();

      const res = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items).toHaveLength(1);
      expect(res.body.data.items[0]).toMatchObject({ available: false, availabilityReason: "VARIANT_UNAVAILABLE", availableQuantity: 0 });
    });
  });

  // ---------------------------------------------------------------------
  // Price authority
  // ---------------------------------------------------------------------
  describe("Price Authority", () => {
    it("reflects the current product price, not the price at add time", async () => {
      const product = await createSimpleProduct({ price: "499.00", stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });

      product.price = "599.00";
      await product.save();

      const res = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items[0].price).toBe("599.00");
      expect(res.body.data.items[0].subtotal).toBe("599.00");
    });

    it("reflects the current variant price, not the price at add time", async () => {
      const product = await createVariantProduct();
      const variant = await createVariant(product.id, { price: "299.00", stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, variantId: variant.id, quantity: 1 });

      variant.price = "349.00";
      await variant.save();

      const res = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(res.body.data.items[0].price).toBe("349.00");
    });

    it("computes exact decimal subtotal without floating-point drift", async () => {
      const product = await createSimpleProduct({ price: "19.99", stock: 10 });
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 3 });

      expect(res.body.data.items[0].subtotal).toBe("59.97");
      expect(res.body.data.subtotal).toBe("59.97");
    });
  });

  // ---------------------------------------------------------------------
  // Guest cart
  // ---------------------------------------------------------------------
  describe("Guest Cart", () => {
    it("creates and persists a guest cart across requests via a secure cookie", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const agent = request.agent(app);

      // The guest cookie is minted on the first unauthenticated touch of any cart route,
      // not specifically on add — so it appears on this initial empty GET.
      const emptyRes = await agent.get(CART_URL);
      expect(emptyRes.body.data.id).toBeNull();
      const setCookieHeader = emptyRes.headers["set-cookie"] as unknown as string | string[] | undefined;
      const setCookies = Array.isArray(setCookieHeader) ? setCookieHeader : setCookieHeader ? [setCookieHeader] : [];
      expect(setCookies.some((c) => c.startsWith("mypetmart_guest_cart="))).toBe(true);

      const addRes = await agent.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });
      expect(addRes.status).toBe(201);

      const followUp = await agent.get(CART_URL);
      expect(followUp.body.data.items).toHaveLength(1);
    });

    it("isolates carts between two different guests", async () => {
      const productOne = await createSimpleProduct({ stock: 10 });
      const productTwo = await createSimpleProduct({ stock: 10 });
      const guestA = request.agent(app);
      const guestB = request.agent(app);

      await guestA.post(`${CART_URL}/items`).send({ productId: productOne.id, quantity: 1 });
      await guestB.post(`${CART_URL}/items`).send({ productId: productTwo.id, quantity: 1 });

      const aCart = await guestA.get(CART_URL);
      const bCart = await guestB.get(CART_URL);
      expect(aCart.body.data.items).toHaveLength(1);
      expect(aCart.body.data.items[0].productId).toBe(productOne.id);
      expect(bCart.body.data.items).toHaveLength(1);
      expect(bCart.body.data.items[0].productId).toBe(productTwo.id);
    });

    it("does not resolve a forged/guessed guest cookie to another guest's cart", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = request.agent(app);
      await guest.post(`${CART_URL}/items`).send({ productId: product.id, quantity: 1 });

      const forgedRes = await request(app).get(CART_URL).set("Cookie", "mypetmart_guest_cart=0000000000000000000000000000000000000000000000000000000000000000");
      expect(forgedRes.status).toBe(200);
      expect(forgedRes.body.data.id).toBeNull();
      expect(forgedRes.body.data.items).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // Guest -> Customer merge
  // ---------------------------------------------------------------------
  describe("Guest to Customer Merge", () => {
    async function guestAgentWithItem(productId: number, quantity: number) {
      const agent = request.agent(app);
      await agent.post(`${CART_URL}/items`).send({ productId, quantity });
      return agent;
    }

    it("merges a guest-only item into the customer's cart", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 2);

      const mergeRes = await guest.post(`${CART_URL}/merge`).set("Authorization", `Bearer ${customerAToken}`);
      expect(mergeRes.status).toBe(200);
      expect(mergeRes.body.data.cart.items).toHaveLength(1);
      expect(mergeRes.body.data.cart.items[0]).toMatchObject({ productId: product.id, quantity: 2 });
      expect(mergeRes.body.data.mergeReport.mergedItems).toHaveLength(1);
    });

    it("preserves a customer-only item that the guest never had", async () => {
      const guestOnlyProduct = await createSimpleProduct({ stock: 10 });
      const customerOnlyProduct = await createSimpleProduct({ stock: 10 });

      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: customerOnlyProduct.id, quantity: 1 });
      const guest = await guestAgentWithItem(guestOnlyProduct.id, 1);

      const mergeRes = await guest.post(`${CART_URL}/merge`).set("Authorization", `Bearer ${customerAToken}`);
      const productIds = mergeRes.body.data.cart.items.map((i: { productId: number }) => i.productId).sort();
      expect(productIds).toEqual([guestOnlyProduct.id, customerOnlyProduct.id].sort());
    });

    it("combines quantities for the same logical item present in both carts", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 2 });
      const guest = await guestAgentWithItem(product.id, 3);

      const mergeRes = await guest.post(`${CART_URL}/merge`).set("Authorization", `Bearer ${customerAToken}`);
      expect(mergeRes.body.data.cart.items).toHaveLength(1);
      expect(mergeRes.body.data.cart.items[0].quantity).toBe(5);
    });

    it("caps the merged quantity at available stock and reports the adjustment", async () => {
      const product = await createSimpleProduct({ stock: 4 });
      await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 2 });
      const guest = await guestAgentWithItem(product.id, 3);

      const mergeRes = await guest.post(`${CART_URL}/merge`).set("Authorization", `Bearer ${customerAToken}`);
      expect(mergeRes.body.data.cart.items[0].quantity).toBe(4);
      expect(mergeRes.body.data.mergeReport.adjustedItems).toHaveLength(1);
      expect(mergeRes.body.data.mergeReport.adjustedItems[0]).toMatchObject({ productId: product.id, finalQuantity: 4 });
    });

    it("safely skips a guest item whose product became unavailable before merge", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 2);

      product.status = "archived";
      await product.save();

      const mergeRes = await guest.post(`${CART_URL}/merge`).set("Authorization", `Bearer ${customerAToken}`);
      expect(mergeRes.status).toBe(200);
      expect(mergeRes.body.data.cart.items).toHaveLength(0);
      expect(mergeRes.body.data.mergeReport.skippedItems).toHaveLength(1);
      expect(mergeRes.body.data.mergeReport.skippedItems[0].productId).toBe(product.id);
    });

    it("is idempotent: calling merge again with no active guest cart is a safe no-op", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      const first = await guest.post(`${CART_URL}/merge`).set("Authorization", `Bearer ${customerAToken}`);
      expect(first.body.data.cart.items).toHaveLength(1);

      const second = await guest.post(`${CART_URL}/merge`).set("Authorization", `Bearer ${customerAToken}`);
      expect(second.status).toBe(200);
      expect(second.body.data.cart.items).toHaveLength(1);
      expect(second.body.data.mergeReport.mergedItems).toHaveLength(0);
      expect(second.body.data.mergeReport.adjustedItems).toHaveLength(0);
      expect(second.body.data.mergeReport.skippedItems).toHaveLength(0);
    });

    it("retires the guest cart after merge so its old cookie no longer resolves to it", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const guest = await guestAgentWithItem(product.id, 1);

      await guest.post(`${CART_URL}/merge`).set("Authorization", `Bearer ${customerAToken}`);

      const staleRead = await guest.get(CART_URL);
      expect(staleRead.body.data.id).toBeNull();
      expect(staleRead.body.data.items).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------
  // Concurrency
  // ---------------------------------------------------------------------
  describe("Concurrency", () => {
    it("does not create duplicate logical lines under concurrent duplicate adds", async () => {
      const product = await createSimpleProduct({ stock: 50 });

      const [resA, resB] = await Promise.all([
        request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 2 }),
        request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 3 })
      ]);

      expect(resA.status).toBe(201);
      expect(resB.status).toBe(201);

      const finalCart = await request(app).get(CART_URL).set("Authorization", `Bearer ${customerAToken}`);
      expect(finalCart.body.data.items).toHaveLength(1);
      expect(finalCart.body.data.items[0].quantity).toBe(5);

      const cart = await Cart.findOne({ where: { user_id: 99301, status: "active" } });
      const rows = await CartItem.findAll({ where: { cart_id: cart!.id, product_id: product.id } });
      expect(rows).toHaveLength(1);
    });

    it("preserves a single consistent row under concurrent quantity updates", async () => {
      const product = await createSimpleProduct({ stock: 50 });
      const addRes = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      const cartItemId = addRes.body.data.items[0].cartItemId;

      const [resA, resB] = await Promise.all([
        request(app).patch(`${CART_URL}/items/${cartItemId}`).set("Authorization", `Bearer ${customerAToken}`).send({ quantity: 4 }),
        request(app).patch(`${CART_URL}/items/${cartItemId}`).set("Authorization", `Bearer ${customerAToken}`).send({ quantity: 7 })
      ]);

      expect([resA.status, resB.status]).toEqual([200, 200]);

      const rows = await CartItem.findAll({ where: { id: cartItemId } });
      expect(rows).toHaveLength(1);
      expect([4, 7]).toContain(rows[0]!.quantity);
    });
  });

  // ---------------------------------------------------------------------
  // Images
  // ---------------------------------------------------------------------
  describe("Product Images in Cart", () => {
    it("includes the primary product image", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      await createImage(product.id, { is_primary: false, sort_order: 1, alt: "Secondary" });
      const primary = await createImage(product.id, { is_primary: true, sort_order: 0, alt: "Primary" });

      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      // The URL is computed from r2_key via the R2 public base URL when configured, falling
      // back to the stored `url` column otherwise — assert the resolvable identity, not a fixed host.
      expect(res.body.data.items[0].image.alt).toBe("Primary");
      expect(res.body.data.items[0].image.url).toContain(primary.r2_key);
    });

    it("returns a null image for a product without any images", async () => {
      const product = await createSimpleProduct({ stock: 10 });
      const res = await request(app).post(`${CART_URL}/items`).set("Authorization", `Bearer ${customerAToken}`).send({ productId: product.id, quantity: 1 });
      expect(res.body.data.items[0].image).toBeNull();
    });
  });
});
