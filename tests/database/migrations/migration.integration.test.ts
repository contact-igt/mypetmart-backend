import { QueryTypes } from "sequelize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectDatabase, disconnectDatabase, sequelize } from "../../../src/database/index.js";
import { createMigrator, withMigrationLock } from "../../../src/database/migrations/migrator.js";
import { verifySchema } from "../../../src/database/migrations/schema-verifier.js";

type CountRow = { count: number };
type NullableReferenceRow = { productId: string | null; productVariantId: string | null };

const ids = {
  customer: "11111111-1111-1111-1111-111111111111",
  admin: "11111111-1111-1111-1111-111111111112",
  category: "22222222-2222-2222-2222-222222222222",
  product: "33333333-3333-3333-3333-333333333333",
  variantA: "44444444-4444-4444-4444-444444444441",
  variantB: "44444444-4444-4444-4444-444444444442",
  cart: "55555555-5555-5555-5555-555555555555",
  order: "66666666-6666-6666-6666-666666666666",
  historicalProduct: "77777777-7777-7777-7777-777777777771",
  historicalVariantProduct: "77777777-7777-7777-7777-777777777772",
  historicalVariant: "88888888-8888-8888-8888-888888888888"
} as const;

async function resetSchemaToEmpty(): Promise<void> {
  await withMigrationLock(sequelize, async () => {
    await createMigrator(sequelize).down({ to: 0 });
    await sequelize.getQueryInterface().dropTable("SequelizeMeta").catch(() => undefined);
  });
}

async function applySchema(): Promise<void> {
  await withMigrationLock(sequelize, async () => createMigrator(sequelize).up());
}

async function expectSqlRejected(sql: string, replacements: Record<string, unknown>): Promise<void> {
  await expect(sequelize.query(sql, { replacements })).rejects.toBeTruthy();
}

async function countRows(tableName: string): Promise<number> {
  const [row] = await sequelize.query<CountRow>(`SELECT COUNT(*) AS count FROM \`${tableName}\``, { type: QueryTypes.SELECT });
  return row?.count ?? 0;
}

describe("Stage 5 initial schema migrations", () => {
  beforeAll(async () => {
    await connectDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  it("applies, verifies constraints, rolls back to empty, and reapplies", async () => {
    await resetSchemaToEmpty();
    expect(await verifySchema({ expectEmpty: true })).toEqual({ ok: true, failures: [] });

    await applySchema();
    expect(await verifySchema()).toEqual({ ok: true, failures: [] });
    expect(await countRows("SequelizeMeta")).toBe(18);

    await sequelize.query(
      "INSERT INTO users (id, role, status, name, email, password_hash) VALUES (:id, 'customer', 'active', 'Customer One', 'customer@example.com', 'hash'), (:admin, 'admin', 'active', 'Admin One', 'admin@example.com', 'hash')",
      { replacements: { id: ids.customer, admin: ids.admin } }
    );
    await sequelize.query("INSERT INTO categories (id, name, slug) VALUES (:id, 'Dog Food', 'dog-food')", { replacements: { id: ids.category } });
    await sequelize.query(
      "INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES (:id, :category, 'Kibble', 'kibble', 'SKU-1', 'Food', 10.00, 5)",
      { replacements: { id: ids.product, category: ids.category } }
    );
    await sequelize.query(
      "INSERT INTO product_variants (id, product_id, name, sku, price, stock) VALUES (:a, :product, 'Small', 'SKU-1-S', 11.00, 3), (:b, :product, 'Large', 'SKU-1-L', 12.00, 4)",
      { replacements: { a: ids.variantA, b: ids.variantB, product: ids.product } }
    );

    await expectSqlRejected("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES ('33333333-3333-3333-3333-333333333334', :category, 'Bad', 'bad-price', 'SKU-BAD', 'Food', 0, 1)", { category: ids.category });
    await expectSqlRejected("INSERT INTO products (id, category_id, name, slug, sku, description, price, compare_at_price, stock) VALUES ('33333333-3333-3333-3333-333333333335', :category, 'Bad Compare', 'bad-compare', 'SKU-BAD-C', 'Food', 20, 10, 1)", { category: ids.category });
    await expectSqlRejected("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES ('33333333-3333-3333-3333-333333333336', :category, 'Bad Stock', 'bad-stock', 'SKU-BAD-S', 'Food', 10, -1)", { category: ids.category });
    await expectSqlRejected("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES ('33333333-3333-3333-3333-333333333337', :category, 'Duplicate SKU', 'duplicate-sku', 'SKU-1', 'Food', 10, 1)", { category: ids.category });

    await sequelize.query("INSERT INTO product_images (id, product_id, r2_key, url, alt, content_type, is_primary) VALUES ('99999999-9999-9999-9999-999999999991', :product, 'products/one.jpg', 'https://cdn.example/one.jpg', 'One', 'image/jpeg', 1)", { replacements: { product: ids.product } });
    await expectSqlRejected("INSERT INTO product_images (id, product_id, r2_key, url, alt, content_type, is_primary) VALUES ('99999999-9999-9999-9999-999999999992', :product, 'products/two.jpg', 'https://cdn.example/two.jpg', 'Two', 'image/jpeg', 1)", { product: ids.product });
    await sequelize.query("INSERT INTO product_images (id, product_id, r2_key, url, alt, content_type, is_primary) VALUES ('99999999-9999-9999-9999-999999999993', :product, 'products/three.jpg', 'https://cdn.example/three.jpg', 'Three', 'image/jpeg', 0), ('99999999-9999-9999-9999-999999999994', :product, 'products/four.jpg', 'https://cdn.example/four.jpg', 'Four', 'image/jpeg', 0)", { replacements: { product: ids.product } });

    await sequelize.query("INSERT INTO addresses (id, user_id, recipient_name, phone, line_1, city, state, postal_code, is_default) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa1', :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456', 1)", { replacements: { user: ids.customer } });
    await expectSqlRejected("INSERT INTO addresses (id, user_id, recipient_name, phone, line_1, city, state, postal_code, is_default) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa2', :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456', 1)", { user: ids.customer });
    await sequelize.query("INSERT INTO addresses (id, user_id, recipient_name, phone, line_1, city, state, postal_code, is_default) VALUES ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa3', :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456', 0), ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaa4', :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456', 0)", { replacements: { user: ids.customer } });

    await sequelize.query("INSERT INTO carts (id, user_id) VALUES (:cart, :user)", { replacements: { cart: ids.cart, user: ids.customer } });
    await sequelize.query("INSERT INTO cart_items (id, cart_id, product_id, quantity) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb1', :cart, :product, 1)", { replacements: { cart: ids.cart, product: ids.product } });
    await expectSqlRejected("INSERT INTO cart_items (id, cart_id, product_id, quantity) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb2', :cart, :product, 1)", { cart: ids.cart, product: ids.product });
    await expectSqlRejected("INSERT INTO cart_items (id, cart_id, product_id, quantity) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb3', :cart, :product, 0)", { cart: ids.cart, product: ids.product });
    await sequelize.query("INSERT INTO cart_items (id, cart_id, product_id, product_variant_id, quantity) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb4', :cart, :product, :variantA, 1), ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb5', :cart, :product, :variantB, 1)", { replacements: { cart: ids.cart, product: ids.product, variantA: ids.variantA, variantB: ids.variantB } });
    await expectSqlRejected("INSERT INTO cart_items (id, cart_id, product_id, product_variant_id, quantity) VALUES ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbb6', :cart, :product, :variantA, 1)", { cart: ids.cart, product: ids.product, variantA: ids.variantA });

    await sequelize.query("INSERT INTO orders (id, order_number, user_id, ship_recipient_name, ship_phone, ship_line_1, ship_city, ship_state, ship_postal_code) VALUES (:order, 'MPM-1', :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456')", { replacements: { order: ids.order, user: ids.customer } });
    await expectSqlRejected("INSERT INTO orders (id, order_number, user_id, ship_recipient_name, ship_phone, ship_line_1, ship_city, ship_state, ship_postal_code) VALUES ('66666666-6666-6666-6666-666666666667', 'MPM-1', :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456')", { user: ids.customer });
    await sequelize.query("INSERT INTO payments (id, order_id, provider, amount) VALUES ('cccccccc-cccc-cccc-cccc-ccccccccccc1', :order, 'manual', 10), ('cccccccc-cccc-cccc-cccc-ccccccccccc2', :order, 'manual', 10)", { replacements: { order: ids.order } });
    await sequelize.query("INSERT INTO shipments (id, order_id) VALUES ('dddddddd-dddd-dddd-dddd-ddddddddddd1', :order), ('dddddddd-dddd-dddd-dddd-ddddddddddd2', :order)", { replacements: { order: ids.order } });

    await sequelize.query("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES (:product, :category, 'Historical', 'historical', 'SKU-H', 'Food', 10, 1)", { replacements: { product: ids.historicalProduct, category: ids.category } });
    await sequelize.query("INSERT INTO order_items (id, order_id, product_id, product_name, product_sku, quantity, unit_price, line_total) VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1', :order, :product, 'Historical', 'SKU-H', 1, 10, 10)", { replacements: { order: ids.order, product: ids.historicalProduct } });
    await sequelize.query("DELETE FROM products WHERE id = :product", { replacements: { product: ids.historicalProduct } });
    const [productNullRow] = await sequelize.query<NullableReferenceRow>("SELECT product_id AS productId, product_variant_id AS productVariantId FROM order_items WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee1'", { type: QueryTypes.SELECT });
    expect(productNullRow?.productId).toBeNull();

    await sequelize.query("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES (:product, :category, 'Historical Variant Product', 'historical-variant-product', 'SKU-HV', 'Food', 10, 1)", { replacements: { product: ids.historicalVariantProduct, category: ids.category } });
    await sequelize.query("INSERT INTO product_variants (id, product_id, name, sku, price, stock) VALUES (:variant, :product, 'Only Variant', 'SKU-HV-1', 10, 1)", { replacements: { variant: ids.historicalVariant, product: ids.historicalVariantProduct } });
    await sequelize.query("INSERT INTO order_items (id, order_id, product_id, product_variant_id, product_name, product_sku, variant_name, variant_sku, quantity, unit_price, line_total) VALUES ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2', :order, :product, :variant, 'Historical Variant Product', 'SKU-HV', 'Only Variant', 'SKU-HV-1', 1, 10, 10)", { replacements: { order: ids.order, product: ids.historicalVariantProduct, variant: ids.historicalVariant } });
    await sequelize.query("DELETE FROM product_variants WHERE id = :variant", { replacements: { variant: ids.historicalVariant } });
    const [variantNullRow] = await sequelize.query<NullableReferenceRow>("SELECT product_id AS productId, product_variant_id AS productVariantId FROM order_items WHERE id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeee2'", { type: QueryTypes.SELECT });
    expect(variantNullRow?.productId).toBe(ids.historicalVariantProduct);
    expect(variantNullRow?.productVariantId).toBeNull();

    await resetSchemaToEmpty();
    expect(await verifySchema({ expectEmpty: true })).toEqual({ ok: true, failures: [] });

    await applySchema();
    expect(await verifySchema()).toEqual({ ok: true, failures: [] });
    expect(await countRows("SequelizeMeta")).toBe(18);
  });
});
