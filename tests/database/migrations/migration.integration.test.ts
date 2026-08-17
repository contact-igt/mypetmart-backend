import { QueryTypes } from "sequelize";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { connectDatabase, disconnectDatabase, sequelize } from "../../../src/database/index.js";
import {
  createMigrator,
  expectedMigrationNames,
  withMigrationLock
} from "../../../src/database/migrations/migrator.js";
import { verifySchema } from "../../../src/database/migrations/schema-verifier.js";
import { SEEDER_METADATA_TABLE_NAME } from "../../../src/database/seeders/seeder.constants.js";

type CountRow = { count: number };
type NullableReferenceRow = { productId: number | null; productVariantId: number | null };

const ids = {
  customer: 101,
  admin: 102,
  superAdmin: 103,
  category: 201,
  product: 301,
  variantA: 401,
  variantB: 402,
  cart: 501,
  order: 601,
  historicalProduct: 701,
  historicalVariantProduct: 702,
  historicalVariant: 801
} as const;

async function resetSchemaToEmpty(): Promise<void> {
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 0").catch(() => undefined);
  await sequelize.query("DELETE FROM users").catch(() => undefined);
  await sequelize.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => undefined);
  await withMigrationLock(sequelize, async () => {
    await createMigrator(sequelize).down({ to: 0 });
    await sequelize.getQueryInterface().dropTable("SequelizeMeta").catch(() => undefined);
    await sequelize.getQueryInterface().dropTable(SEEDER_METADATA_TABLE_NAME).catch(() => undefined);
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

async function expectRegisteredMigrationsApplied(): Promise<void> {
  const registered = expectedMigrationNames();
  const migrator = createMigrator(sequelize);
  const [executed, pending] = await Promise.all([migrator.executed(), migrator.pending()]);
  const appliedNames = executed.map((migration) => migration.name);

  expect(new Set(registered).size).toBe(registered.length);
  expect(appliedNames).toEqual(registered);
  expect(pending).toEqual([]);
  expect(await countRows("SequelizeMeta")).toBe(registered.length);
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
    await expectRegisteredMigrationsApplied();

    await sequelize.query(
      "INSERT INTO users (id, role, status, name, email, password_hash, reference_code) VALUES (:id, 'customer', 'active', 'Customer One', 'customer@example.com', 'hash', 'CUS-000101'), (:admin, 'admin', 'active', 'Admin One', 'admin@example.com', 'hash', 'ADM-000102'), (:superAdmin, 'super_admin', 'active', 'Super Admin One', 'super_admin@example.com', 'hash', 'SUP-000103')",
      { replacements: { id: ids.customer, admin: ids.admin, superAdmin: ids.superAdmin } }
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

    await expectSqlRejected("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES (304, :category, 'Bad', 'bad-price', 'SKU-BAD', 'Food', -0.01, 1)", { category: ids.category });
    await expectSqlRejected("INSERT INTO products (id, category_id, name, slug, sku, description, price, compare_at_price, stock) VALUES (305, :category, 'Bad Compare', 'bad-compare', 'SKU-BAD-C', 'Food', 20, 10, 1)", { category: ids.category });
    await expectSqlRejected("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES (306, :category, 'Bad Stock', 'bad-stock', 'SKU-BAD-S', 'Food', 10, -1)", { category: ids.category });
    await expectSqlRejected("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES (307, :category, 'Duplicate SKU', 'duplicate-sku', 'SKU-1', 'Food', 10, 1)", { category: ids.category });

    await sequelize.query("INSERT INTO product_images (id, product_id, r2_key, url, alt, content_type, is_primary) VALUES (901, :product, 'products/one.jpg', 'https://cdn.example/one.jpg', 'One', 'image/jpeg', 1)", { replacements: { product: ids.product } });
    await expectSqlRejected("INSERT INTO product_images (id, product_id, r2_key, url, alt, content_type, is_primary) VALUES (902, :product, 'products/two.jpg', 'https://cdn.example/two.jpg', 'Two', 'image/jpeg', 1)", { product: ids.product });
    await sequelize.query("INSERT INTO product_images (id, product_id, r2_key, url, alt, content_type, is_primary) VALUES (903, :product, 'products/three.jpg', 'https://cdn.example/three.jpg', 'Three', 'image/jpeg', 0), (904, :product, 'products/four.jpg', 'https://cdn.example/four.jpg', 'Four', 'image/jpeg', 0)", { replacements: { product: ids.product } });

    await sequelize.query("INSERT INTO addresses (id, user_id, recipient_name, phone, line_1, city, state, postal_code, is_default) VALUES (8001, :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456', 1)", { replacements: { user: ids.customer } });
    await expectSqlRejected("INSERT INTO addresses (id, user_id, recipient_name, phone, line_1, city, state, postal_code, is_default) VALUES (8002, :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456', 1)", { user: ids.customer });
    await sequelize.query("INSERT INTO addresses (id, user_id, recipient_name, phone, line_1, city, state, postal_code, is_default) VALUES (8003, :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456', 0), (8004, :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456', 0)", { replacements: { user: ids.customer } });

    await sequelize.query("INSERT INTO carts (id, user_id) VALUES (:cart, :user)", { replacements: { cart: ids.cart, user: ids.customer } });
    await sequelize.query("INSERT INTO cart_items (id, cart_id, product_id, quantity) VALUES (8101, :cart, :product, 1)", { replacements: { cart: ids.cart, product: ids.product } });
    await expectSqlRejected("INSERT INTO cart_items (id, cart_id, product_id, quantity) VALUES (8102, :cart, :product, 1)", { cart: ids.cart, product: ids.product });
    await expectSqlRejected("INSERT INTO cart_items (id, cart_id, product_id, quantity) VALUES (8103, :cart, :product, 0)", { cart: ids.cart, product: ids.product });
    await sequelize.query("INSERT INTO cart_items (id, cart_id, product_id, product_variant_id, quantity) VALUES (8104, :cart, :product, :variantA, 1), (8105, :cart, :product, :variantB, 1)", { replacements: { cart: ids.cart, product: ids.product, variantA: ids.variantA, variantB: ids.variantB } });
    await expectSqlRejected("INSERT INTO cart_items (id, cart_id, product_id, product_variant_id, quantity) VALUES (8106, :cart, :product, :variantA, 1)", { cart: ids.cart, product: ids.product, variantA: ids.variantA });

    await sequelize.query("INSERT INTO orders (id, order_number, user_id, ship_recipient_name, ship_phone, ship_line_1, ship_city, ship_state, ship_postal_code) VALUES (:order, 'MPM-1', :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456')", { replacements: { order: ids.order, user: ids.customer } });
    await expectSqlRejected("INSERT INTO orders (id, order_number, user_id, ship_recipient_name, ship_phone, ship_line_1, ship_city, ship_state, ship_postal_code) VALUES (602, 'MPM-1', :user, 'Customer One', '9999999999', 'Line', 'City', 'State', '123456')", { user: ids.customer });
    await sequelize.query("INSERT INTO payments (id, order_id, provider, amount) VALUES (8201, :order, 'manual', 10), (8202, :order, 'manual', 10)", { replacements: { order: ids.order } });
    await sequelize.query("INSERT INTO shipments (id, order_id) VALUES (8301, :order), (8302, :order)", { replacements: { order: ids.order } });

    await sequelize.query("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES (:product, :category, 'Historical', 'historical', 'SKU-H', 'Food', 10, 1)", { replacements: { product: ids.historicalProduct, category: ids.category } });
    await sequelize.query("INSERT INTO order_items (id, order_id, product_id, product_name, product_sku, quantity, unit_price, line_total) VALUES (8401, :order, :product, 'Historical', 'SKU-H', 1, 10, 10)", { replacements: { order: ids.order, product: ids.historicalProduct } });
    await sequelize.query("DELETE FROM products WHERE id = :product", { replacements: { product: ids.historicalProduct } });
    const [productNullRow] = await sequelize.query<NullableReferenceRow>("SELECT product_id AS productId, product_variant_id AS productVariantId FROM order_items WHERE id = 8401", { type: QueryTypes.SELECT });
    expect(productNullRow?.productId).toBeNull();

    await sequelize.query("INSERT INTO products (id, category_id, name, slug, sku, description, price, stock) VALUES (:product, :category, 'Historical Variant Product', 'historical-variant-product', 'SKU-HV', 'Food', 10, 1)", { replacements: { product: ids.historicalVariantProduct, category: ids.category } });
    await sequelize.query("INSERT INTO product_variants (id, product_id, name, sku, price, stock) VALUES (:variant, :product, 'Only Variant', 'SKU-HV-1', 10, 1)", { replacements: { variant: ids.historicalVariant, product: ids.historicalVariantProduct } });
    await sequelize.query("INSERT INTO order_items (id, order_id, product_id, product_variant_id, product_name, product_sku, variant_name, variant_sku, quantity, unit_price, line_total) VALUES (8402, :order, :product, :variant, 'Historical Variant Product', 'SKU-HV', 'Only Variant', 'SKU-HV-1', 1, 10, 10)", { replacements: { order: ids.order, product: ids.historicalVariantProduct, variant: ids.historicalVariant } });
    await sequelize.query("DELETE FROM product_variants WHERE id = :variant", { replacements: { variant: ids.historicalVariant } });
    const [variantNullRow] = await sequelize.query<NullableReferenceRow>("SELECT product_id AS productId, product_variant_id AS productVariantId FROM order_items WHERE id = 8402", { type: QueryTypes.SELECT });
    expect(variantNullRow?.productId).toBe(ids.historicalVariantProduct);
    expect(variantNullRow?.productVariantId).toBeNull();

    await resetSchemaToEmpty();
    expect(await verifySchema({ expectEmpty: true })).toEqual({ ok: true, failures: [] });

    await applySchema();
    expect(await verifySchema()).toEqual({ ok: true, failures: [] });
    await expectRegisteredMigrationsApplied();
  }, 30_000);
});
