import {
  AUTH_CHALLENGE_PURPOSE_VALUES,
  CART_STATUS_VALUES,
  CONTACT_ENQUIRY_STATUS_VALUES,
  DATABASE_TABLE_NAMES,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_CURRENCY_CODE,
  FULFILMENT_STATUS_VALUES,
  ORDER_STATUS_VALUES,
  PAYMENT_STATUS_VALUES,
  PET_TYPE_VALUES,
  PRODUCT_STATUS_VALUES,
  RETURN_STATUS_VALUES,
  RETURN_TYPE_VALUES,
  SESSION_TYPE_VALUES,
  SHIPMENT_STATUS_VALUES,
  SHIPPING_METHOD_VALUES,
  USER_ROLE_VALUES,
  USER_STATUS_VALUES
} from "../../constants/database.constants.js";

export type ExpectedIndex = { name: string; columns: readonly string[]; unique: boolean };
export type ExpectedForeignKey = {
  name: string;
  column: string;
  referencedTable: string;
  deleteRule: "RESTRICT" | "CASCADE" | "SET NULL" | "NO ACTION";
  updateRule: "RESTRICT" | "CASCADE" | "SET NULL" | "NO ACTION";
};
export type ExpectedCheck = { name: string };
export type ExpectedColumn = { name: string; nullable: boolean; dataTypeHint: string; generated: boolean; autoIncrement: boolean };
export type SchemaTableDefinition = {
  tableName: string;
  migrationName: string;
  createSql: string;
};

const q = (identifier: string): string => `\`${identifier}\``;
const enumSql = (values: readonly string[]): string => `ENUM(${values.map((value) => `'${value}'`).join(", ")})`;
const createdUpdated = "`created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP";
const deletedAt = "`deleted_at` DATETIME NULL";
const engine = "ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci";

export const INITIAL_SCHEMA_TABLES: readonly SchemaTableDefinition[] = [
  {
    tableName: DATABASE_TABLE_NAMES.users,
    migrationName: "001-create-users",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.users)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`reference_code\` VARCHAR(50) NOT NULL,
        \`role\` ${enumSql(USER_ROLE_VALUES)} NOT NULL DEFAULT 'customer',
        \`status\` ${enumSql(USER_STATUS_VALUES)} NOT NULL DEFAULT 'active',
        \`name\` VARCHAR(160) NOT NULL,
        \`email\` VARCHAR(190) NOT NULL,
        \`phone\` VARCHAR(32) NULL,
        \`password_hash\` VARCHAR(255) NOT NULL,
        \`email_verified_at\` DATETIME NULL,
        \`last_login_at\` DATETIME NULL,
        ${createdUpdated},
        ${deletedAt},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`users_email_unique\` (\`email\`),
        UNIQUE KEY \`users_reference_code_unique\` (\`reference_code\`),
        KEY \`users_role_idx\` (\`role\`),
        KEY \`users_status_idx\` (\`status\`),
        KEY \`users_phone_idx\` (\`phone\`),
        KEY \`users_created_at_idx\` (\`created_at\`),
        KEY \`users_deleted_at_idx\` (\`deleted_at\`)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.authSessions,
    migrationName: "002-create-auth-sessions",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.authSessions)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`user_id\` INT UNSIGNED NOT NULL,
        \`session_type\` ${enumSql(SESSION_TYPE_VALUES)} NOT NULL,
        \`token_hash\` VARCHAR(255) NOT NULL,
        \`user_agent\` VARCHAR(512) NULL,
        \`ip_address\` VARCHAR(64) NULL,
        \`expires_at\` DATETIME NOT NULL,
        \`revoked_at\` DATETIME NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`auth_sessions_token_hash_unique\` (\`token_hash\`),
        KEY \`auth_sessions_user_id_idx\` (\`user_id\`),
        KEY \`auth_sessions_session_type_idx\` (\`session_type\`),
        KEY \`auth_sessions_expires_at_idx\` (\`expires_at\`),
        KEY \`auth_sessions_revoked_at_idx\` (\`revoked_at\`),
        CONSTRAINT \`fk_auth_sessions_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.addresses,
    migrationName: "003-create-addresses",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.addresses)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`user_id\` INT UNSIGNED NOT NULL,
        \`label\` VARCHAR(80) NULL,
        \`recipient_name\` VARCHAR(160) NOT NULL,
        \`phone\` VARCHAR(32) NOT NULL,
        \`line_1\` VARCHAR(255) NOT NULL,
        \`line_2\` VARCHAR(255) NULL,
        \`city\` VARCHAR(120) NOT NULL,
        \`state\` VARCHAR(120) NOT NULL,
        \`postal_code\` VARCHAR(20) NOT NULL,
        \`country\` VARCHAR(2) NOT NULL DEFAULT '${DEFAULT_COUNTRY_CODE}',
        \`is_default\` TINYINT(1) NOT NULL DEFAULT 0,
        \`default_user_id\` INT UNSIGNED GENERATED ALWAYS AS (CASE WHEN \`is_default\` = 1 THEN \`user_id\` ELSE NULL END) STORED,
        ${createdUpdated},
        ${deletedAt},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`addresses_one_default_user_unique\` (\`default_user_id\`),
        KEY \`addresses_user_id_idx\` (\`user_id\`),
        KEY \`addresses_user_default_idx\` (\`user_id\`, \`is_default\`),
        KEY \`addresses_city_state_idx\` (\`city\`, \`state\`),
        KEY \`addresses_postal_code_idx\` (\`postal_code\`),
        KEY \`addresses_deleted_at_idx\` (\`deleted_at\`),
        CONSTRAINT \`fk_addresses_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.categories,
    migrationName: "004-create-categories",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.categories)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`name\` VARCHAR(160) NOT NULL,
        \`slug\` VARCHAR(190) NOT NULL,
        \`description\` TEXT NULL,
        \`pet_type\` ${enumSql(PET_TYPE_VALUES)} NOT NULL DEFAULT 'all',
        \`active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`display_order\` INT NOT NULL DEFAULT 0,
        \`image_key\` VARCHAR(512) NULL,
        \`image_url\` VARCHAR(1000) NULL,
        \`image_alt\` VARCHAR(255) NULL,
        ${createdUpdated},
        ${deletedAt},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`categories_slug_unique\` (\`slug\`),
        KEY \`categories_active_order_idx\` (\`active\`, \`display_order\`),
        KEY \`categories_pet_type_idx\` (\`pet_type\`),
        KEY \`categories_deleted_at_idx\` (\`deleted_at\`),
        CONSTRAINT \`chk_categories_display_order_nonnegative\` CHECK (\`display_order\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.products,
    migrationName: "005-create-products",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.products)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`category_id\` INT UNSIGNED NOT NULL,
        \`name\` VARCHAR(190) NOT NULL,
        \`slug\` VARCHAR(190) NOT NULL,
        \`sku\` VARCHAR(100) NOT NULL,
        \`description\` TEXT NOT NULL,
        \`pet_type\` ${enumSql(PET_TYPE_VALUES)} NOT NULL DEFAULT 'all',
        \`status\` ${enumSql(PRODUCT_STATUS_VALUES)} NOT NULL DEFAULT 'draft',
        \`price\` DECIMAL(10,2) NOT NULL,
        \`compare_at_price\` DECIMAL(10,2) NULL,
        \`stock\` INT NOT NULL DEFAULT 0,
        \`has_variants\` TINYINT(1) NOT NULL DEFAULT 0,
        \`featured\` TINYINT(1) NOT NULL DEFAULT 0,
        \`tags\` JSON NULL,
        \`meta_title\` VARCHAR(190) NULL,
        \`meta_description\` VARCHAR(255) NULL,
        \`weight_grams\` INT UNSIGNED NULL,
        \`length_cm\` DECIMAL(8,2) NULL,
        \`width_cm\` DECIMAL(8,2) NULL,
        \`height_cm\` DECIMAL(8,2) NULL,
        ${createdUpdated},
        ${deletedAt},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`products_slug_unique\` (\`slug\`),
        UNIQUE KEY \`products_sku_unique\` (\`sku\`),
        KEY \`products_category_status_idx\` (\`category_id\`, \`status\`),
        KEY \`products_pet_status_idx\` (\`pet_type\`, \`status\`),
        KEY \`products_featured_status_idx\` (\`featured\`, \`status\`),
        KEY \`products_stock_idx\` (\`stock\`),
        KEY \`products_created_at_idx\` (\`created_at\`),
        KEY \`products_updated_at_idx\` (\`updated_at\`),
        KEY \`products_deleted_at_idx\` (\`deleted_at\`),
        CONSTRAINT \`fk_products_category_id\` FOREIGN KEY (\`category_id\`) REFERENCES \`categories\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_products_price_nonnegative\` CHECK (\`price\` >= 0),
        CONSTRAINT \`chk_products_compare_at_price\` CHECK (\`compare_at_price\` IS NULL OR \`compare_at_price\` >= \`price\`),
        CONSTRAINT \`chk_products_stock_nonnegative\` CHECK (\`stock\` >= 0),
        CONSTRAINT \`chk_products_weight_grams_positive\` CHECK (\`weight_grams\` IS NULL OR \`weight_grams\` > 0),
        CONSTRAINT \`chk_products_length_cm_positive\` CHECK (\`length_cm\` IS NULL OR \`length_cm\` > 0),
        CONSTRAINT \`chk_products_width_cm_positive\` CHECK (\`width_cm\` IS NULL OR \`width_cm\` > 0),
        CONSTRAINT \`chk_products_height_cm_positive\` CHECK (\`height_cm\` IS NULL OR \`height_cm\` > 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.productVariants,
    migrationName: "006-create-product-variants",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.productVariants)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`name\` VARCHAR(160) NOT NULL,
        \`sku\` VARCHAR(100) NOT NULL,
        \`price\` DECIMAL(10,2) NOT NULL,
        \`compare_at_price\` DECIMAL(10,2) NULL,
        \`stock\` INT NOT NULL DEFAULT 0,
        \`active\` TINYINT(1) NOT NULL DEFAULT 1,
        \`display_order\` INT NOT NULL DEFAULT 0,
        \`weight_grams\` INT UNSIGNED NULL,
        \`length_cm\` DECIMAL(8,2) NULL,
        \`width_cm\` DECIMAL(8,2) NULL,
        \`height_cm\` DECIMAL(8,2) NULL,
        ${createdUpdated},
        ${deletedAt},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`product_variants_sku_unique\` (\`sku\`),
        KEY \`product_variants_product_active_order_idx\` (\`product_id\`, \`active\`, \`display_order\`),
        KEY \`product_variants_stock_idx\` (\`stock\`),
        KEY \`product_variants_deleted_at_idx\` (\`deleted_at\`),
        CONSTRAINT \`fk_product_variants_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_product_variants_price_positive\` CHECK (\`price\` > 0),
        CONSTRAINT \`chk_product_variants_compare_at_price\` CHECK (\`compare_at_price\` IS NULL OR \`compare_at_price\` >= \`price\`),
        CONSTRAINT \`chk_product_variants_stock_nonnegative\` CHECK (\`stock\` >= 0),
        CONSTRAINT \`chk_product_variants_display_order_nonnegative\` CHECK (\`display_order\` >= 0),
        CONSTRAINT \`chk_product_variants_weight_grams_positive\` CHECK (\`weight_grams\` IS NULL OR \`weight_grams\` > 0),
        CONSTRAINT \`chk_product_variants_length_cm_positive\` CHECK (\`length_cm\` IS NULL OR \`length_cm\` > 0),
        CONSTRAINT \`chk_product_variants_width_cm_positive\` CHECK (\`width_cm\` IS NULL OR \`width_cm\` > 0),
        CONSTRAINT \`chk_product_variants_height_cm_positive\` CHECK (\`height_cm\` IS NULL OR \`height_cm\` > 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.productImages,
    migrationName: "007-create-product-images",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.productImages)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`r2_key\` VARCHAR(512) NOT NULL,
        \`url\` VARCHAR(1000) NOT NULL,
        \`alt\` VARCHAR(255) NOT NULL,
        \`content_type\` VARCHAR(100) NOT NULL,
        \`size_bytes\` INT UNSIGNED NULL,
        \`width\` INT UNSIGNED NULL,
        \`height\` INT UNSIGNED NULL,
        \`sort_order\` INT NOT NULL DEFAULT 0,
        \`is_primary\` TINYINT(1) NOT NULL DEFAULT 0,
        \`primary_product_id\` INT UNSIGNED GENERATED ALWAYS AS (CASE WHEN \`is_primary\` = 1 THEN \`product_id\` ELSE NULL END) STORED,
        ${createdUpdated},
        ${deletedAt},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`product_images_r2_key_unique\` (\`r2_key\`),
        UNIQUE KEY \`product_images_one_primary_unique\` (\`primary_product_id\`),
        KEY \`product_images_product_sort_idx\` (\`product_id\`, \`sort_order\`),
        KEY \`product_images_product_primary_idx\` (\`product_id\`, \`is_primary\`),
        KEY \`product_images_deleted_at_idx\` (\`deleted_at\`),
        CONSTRAINT \`fk_product_images_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_product_images_size_nonnegative\` CHECK (\`size_bytes\` IS NULL OR \`size_bytes\` >= 0),
        CONSTRAINT \`chk_product_images_width_nonnegative\` CHECK (\`width\` IS NULL OR \`width\` >= 0),
        CONSTRAINT \`chk_product_images_height_nonnegative\` CHECK (\`height\` IS NULL OR \`height\` >= 0),
        CONSTRAINT \`chk_product_images_sort_order_nonnegative\` CHECK (\`sort_order\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.carts,
    migrationName: "008-create-carts",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.carts)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`user_id\` INT UNSIGNED NULL,
        \`guest_token_hash\` VARCHAR(255) NULL,
        \`status\` ${enumSql(CART_STATUS_VALUES)} NOT NULL DEFAULT 'active',
        \`expires_at\` DATETIME NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`carts_guest_token_hash_unique\` (\`guest_token_hash\`),
        KEY \`carts_user_status_idx\` (\`user_id\`, \`status\`),
        KEY \`carts_status_expires_idx\` (\`status\`, \`expires_at\`),
        CONSTRAINT \`fk_carts_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE SET NULL ON UPDATE RESTRICT
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.cartItems,
    migrationName: "009-create-cart-items",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.cartItems)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`cart_id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`product_variant_id\` INT UNSIGNED NULL,
        \`variant_identity\` INT UNSIGNED GENERATED ALWAYS AS (COALESCE(\`product_variant_id\`, 0)) STORED,
        \`quantity\` INT NOT NULL DEFAULT 1,
        \`unit_price_snapshot\` DECIMAL(10,2) NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`cart_items_exact_line_unique\` (\`cart_id\`, \`product_id\`, \`variant_identity\`),
        KEY \`cart_items_cart_id_idx\` (\`cart_id\`),
        KEY \`cart_items_product_id_idx\` (\`product_id\`),
        KEY \`cart_items_variant_id_idx\` (\`product_variant_id\`),
        KEY \`cart_items_lookup_idx\` (\`cart_id\`, \`product_id\`, \`product_variant_id\`),
        CONSTRAINT \`fk_cart_items_cart_id\` FOREIGN KEY (\`cart_id\`) REFERENCES \`carts\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT,
        CONSTRAINT \`fk_cart_items_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_cart_items_variant_id\` FOREIGN KEY (\`product_variant_id\`) REFERENCES \`product_variants\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_cart_items_quantity_positive\` CHECK (\`quantity\` > 0),
        CONSTRAINT \`chk_cart_items_unit_price_nonnegative\` CHECK (\`unit_price_snapshot\` IS NULL OR \`unit_price_snapshot\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.orders,
    migrationName: "010-create-orders",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.orders)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`order_number\` VARCHAR(50) NOT NULL,
        \`user_id\` INT UNSIGNED NOT NULL,
        \`status\` ${enumSql(ORDER_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`payment_status\` ${enumSql(PAYMENT_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`fulfilment_status\` ${enumSql(FULFILMENT_STATUS_VALUES)} NOT NULL DEFAULT 'unfulfilled',
        \`subtotal\` DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`shipping_fee\` DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`total\` DECIMAL(10,2) NOT NULL DEFAULT 0,
        \`currency\` CHAR(3) NOT NULL DEFAULT '${DEFAULT_CURRENCY_CODE}',
        \`ship_recipient_name\` VARCHAR(160) NOT NULL,
        \`ship_phone\` VARCHAR(32) NOT NULL,
        \`ship_line_1\` VARCHAR(255) NOT NULL,
        \`ship_line_2\` VARCHAR(255) NULL,
        \`ship_city\` VARCHAR(120) NOT NULL,
        \`ship_state\` VARCHAR(120) NOT NULL,
        \`ship_postal_code\` VARCHAR(20) NOT NULL,
        \`ship_country\` VARCHAR(2) NOT NULL DEFAULT '${DEFAULT_COUNTRY_CODE}',
        \`placed_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`cancelled_at\` DATETIME NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`orders_order_number_unique\` (\`order_number\`),
        KEY \`orders_user_placed_idx\` (\`user_id\`, \`placed_at\`),
        KEY \`orders_status_placed_idx\` (\`status\`, \`placed_at\`),
        KEY \`orders_payment_status_idx\` (\`payment_status\`),
        KEY \`orders_fulfilment_status_idx\` (\`fulfilment_status\`),
        KEY \`orders_ship_state_city_idx\` (\`ship_state\`, \`ship_city\`),
        CONSTRAINT \`fk_orders_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_orders_subtotal_nonnegative\` CHECK (\`subtotal\` >= 0),
        CONSTRAINT \`chk_orders_shipping_fee_nonnegative\` CHECK (\`shipping_fee\` >= 0),
        CONSTRAINT \`chk_orders_total_nonnegative\` CHECK (\`total\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.orderItems,
    migrationName: "011-create-order-items",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.orderItems)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NULL,
        \`product_variant_id\` INT UNSIGNED NULL,
        \`product_name\` VARCHAR(190) NOT NULL,
        \`product_sku\` VARCHAR(100) NOT NULL,
        \`variant_name\` VARCHAR(160) NULL,
        \`variant_sku\` VARCHAR(100) NULL,
        \`product_image\` VARCHAR(1000) NULL,
        \`quantity\` INT NOT NULL,
        \`unit_price\` DECIMAL(10,2) NOT NULL,
        \`line_total\` DECIMAL(10,2) NOT NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        KEY \`order_items_order_id_idx\` (\`order_id\`),
        KEY \`order_items_product_id_idx\` (\`product_id\`),
        KEY \`order_items_variant_id_idx\` (\`product_variant_id\`),
        KEY \`order_items_product_sku_idx\` (\`product_sku\`),
        KEY \`order_items_variant_sku_idx\` (\`variant_sku\`),
        CONSTRAINT \`fk_order_items_order_id\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_order_items_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE SET NULL ON UPDATE RESTRICT,
        CONSTRAINT \`fk_order_items_variant_id\` FOREIGN KEY (\`product_variant_id\`) REFERENCES \`product_variants\` (\`id\`) ON DELETE SET NULL ON UPDATE RESTRICT,
        CONSTRAINT \`chk_order_items_quantity_positive\` CHECK (\`quantity\` > 0),
        CONSTRAINT \`chk_order_items_unit_price_nonnegative\` CHECK (\`unit_price\` >= 0),
        CONSTRAINT \`chk_order_items_line_total_nonnegative\` CHECK (\`line_total\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.orderNotes,
    migrationName: "012-create-order-notes",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.orderNotes)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`admin_id\` INT UNSIGNED NOT NULL,
        \`message\` TEXT NOT NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        KEY \`order_notes_order_created_idx\` (\`order_id\`, \`created_at\`),
        KEY \`order_notes_admin_id_idx\` (\`admin_id\`),
        CONSTRAINT \`fk_order_notes_order_id\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_order_notes_admin_id\` FOREIGN KEY (\`admin_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.payments,
    migrationName: "013-create-payments",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.payments)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`provider\` VARCHAR(80) NOT NULL,
        \`provider_order_id\` VARCHAR(190) NULL,
        \`provider_payment_id\` VARCHAR(190) NULL,
        \`status\` ${enumSql(PAYMENT_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`amount\` DECIMAL(10,2) NOT NULL,
        \`currency\` CHAR(3) NOT NULL DEFAULT '${DEFAULT_CURRENCY_CODE}',
        \`method\` VARCHAR(80) NULL,
        \`paid_at\` DATETIME NULL,
        \`failed_at\` DATETIME NULL,
        \`refunded_at\` DATETIME NULL,
        \`raw_payload\` JSON NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`payments_provider_order_id_unique\` (\`provider_order_id\`),
        UNIQUE KEY \`payments_provider_payment_id_unique\` (\`provider_payment_id\`),
        KEY \`payments_order_id_idx\` (\`order_id\`),
        KEY \`payments_provider_status_idx\` (\`provider\`, \`status\`),
        KEY \`payments_status_idx\` (\`status\`),
        CONSTRAINT \`fk_payments_order_id\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_payments_amount_nonnegative\` CHECK (\`amount\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.shipments,
    migrationName: "014-create-shipments",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.shipments)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`method\` ${enumSql(SHIPPING_METHOD_VALUES)} NOT NULL DEFAULT 'standard',
        \`carrier\` VARCHAR(120) NULL,
        \`tracking_number\` VARCHAR(120) NULL,
        \`status\` ${enumSql(SHIPMENT_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`shipped_at\` DATETIME NULL,
        \`delivered_at\` DATETIME NULL,
        \`provider_shipment_id\` VARCHAR(190) NULL,
        \`raw_payload\` JSON NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`shipments_provider_shipment_id_unique\` (\`provider_shipment_id\`),
        KEY \`shipments_order_id_idx\` (\`order_id\`),
        KEY \`shipments_status_idx\` (\`status\`),
        KEY \`shipments_tracking_number_idx\` (\`tracking_number\`),
        CONSTRAINT \`fk_shipments_order_id\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.returnRequests,
    migrationName: "015-create-return-requests",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.returnRequests)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`return_number\` VARCHAR(50) NOT NULL,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`order_item_id\` INT UNSIGNED NOT NULL,
        \`user_id\` INT UNSIGNED NOT NULL,
        \`type\` ${enumSql(RETURN_TYPE_VALUES)} NOT NULL,
        \`status\` ${enumSql(RETURN_STATUS_VALUES)} NOT NULL DEFAULT 'requested',
        \`reason\` TEXT NOT NULL,
        \`resolution_note\` TEXT NULL,
        \`evidence_image_key\` VARCHAR(512) NULL,
        \`evidence_image_url\` VARCHAR(1000) NULL,
        \`requested_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`resolved_at\` DATETIME NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`return_requests_return_number_unique\` (\`return_number\`),
        KEY \`return_requests_status_requested_idx\` (\`status\`, \`requested_at\`),
        KEY \`return_requests_order_id_idx\` (\`order_id\`),
        KEY \`return_requests_order_item_id_idx\` (\`order_item_id\`),
        KEY \`return_requests_user_id_idx\` (\`user_id\`),
        CONSTRAINT \`fk_return_requests_order_id\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_return_requests_order_item_id\` FOREIGN KEY (\`order_item_id\`) REFERENCES \`order_items\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_return_requests_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.returnNotes,
    migrationName: "016-create-return-notes",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.returnNotes)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`return_request_id\` INT UNSIGNED NOT NULL,
        \`admin_id\` INT UNSIGNED NOT NULL,
        \`message\` TEXT NOT NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        KEY \`return_notes_request_created_idx\` (\`return_request_id\`, \`created_at\`),
        KEY \`return_notes_admin_id_idx\` (\`admin_id\`),
        CONSTRAINT \`fk_return_notes_request_id\` FOREIGN KEY (\`return_request_id\`) REFERENCES \`return_requests\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_return_notes_admin_id\` FOREIGN KEY (\`admin_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.contactEnquiries,
    migrationName: "017-create-contact-enquiries",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.contactEnquiries)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`enquiry_number\` VARCHAR(50) NOT NULL,
        \`name\` VARCHAR(160) NOT NULL,
        \`email\` VARCHAR(190) NOT NULL,
        \`phone\` VARCHAR(32) NULL,
        \`subject\` VARCHAR(190) NOT NULL,
        \`message\` TEXT NOT NULL,
        \`status\` ${enumSql(CONTACT_ENQUIRY_STATUS_VALUES)} NOT NULL DEFAULT 'new',
        \`admin_note\` TEXT NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`contact_enquiries_enquiry_number_unique\` (\`enquiry_number\`),
        KEY \`contact_enquiries_status_created_idx\` (\`status\`, \`created_at\`),
        KEY \`contact_enquiries_email_idx\` (\`email\`),
        KEY \`contact_enquiries_created_at_idx\` (\`created_at\`)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.storeSettings,
    migrationName: "018-create-store-settings",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.storeSettings)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`setting_key\` VARCHAR(120) NOT NULL,
        \`setting_value\` JSON NOT NULL,
        \`is_public\` TINYINT(1) NOT NULL DEFAULT 0,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`store_settings_setting_key_unique\` (\`setting_key\`),
        KEY \`store_settings_is_public_idx\` (\`is_public\`),
        KEY \`store_settings_setting_key_idx\` (\`setting_key\`)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.authChallenges,
    migrationName: "020-create-auth-challenges",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.authChallenges)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`user_id\` INT UNSIGNED NOT NULL,
        \`purpose\` ${enumSql(AUTH_CHALLENGE_PURPOSE_VALUES)} NOT NULL,
        \`code_hash\` VARCHAR(128) NOT NULL,
        \`expires_at\` DATETIME NOT NULL,
        \`attempt_count\` INT UNSIGNED NOT NULL DEFAULT 0,
        \`max_attempts\` INT UNSIGNED NOT NULL DEFAULT 5,
        \`resend_available_at\` DATETIME NOT NULL,
        \`consumed_at\` DATETIME NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        KEY \`auth_challenges_user_purpose_idx\` (\`user_id\`, \`purpose\`),
        KEY \`auth_challenges_code_hash_idx\` (\`code_hash\`),
        KEY \`auth_challenges_expires_at_idx\` (\`expires_at\`),
        CONSTRAINT \`fk_auth_challenges_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.passwordResetTokens,
    migrationName: "021-create-password-reset-tokens",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.passwordResetTokens)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`user_id\` INT UNSIGNED NOT NULL,
        \`token_hash\` VARCHAR(128) NOT NULL,
        \`expires_at\` DATETIME NOT NULL,
        \`consumed_at\` DATETIME NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`password_reset_tokens_token_hash_unique\` (\`token_hash\`),
        KEY \`password_reset_tokens_user_id_idx\` (\`user_id\`),
        KEY \`password_reset_tokens_expires_at_idx\` (\`expires_at\`),
        CONSTRAINT \`fk_password_reset_tokens_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
      ) ${engine};
    `
  }
];

const tableByName = new Map(INITIAL_SCHEMA_TABLES.map((table) => [table.tableName, table]));

export const EXPECTED_BUSINESS_TABLE_NAMES = INITIAL_SCHEMA_TABLES.map((table) => table.tableName);
export const EXPECTED_INFRASTRUCTURE_TABLE_NAMES = ["id_sequences", "catalog_sku_reservations"] as const;
export const EXPECTED_METADATA_TABLE_NAME = "SequelizeMeta";
export const EXPECTED_SCHEMA_TABLE_NAMES = [
  ...EXPECTED_BUSINESS_TABLE_NAMES,
  ...EXPECTED_INFRASTRUCTURE_TABLE_NAMES,
  EXPECTED_METADATA_TABLE_NAME
] as const;

export function getInitialSchemaTable(tableName: string): SchemaTableDefinition {
  const table = tableByName.get(tableName);
  if (!table) {
    throw new Error(`Unknown initial schema table: ${tableName}`);
  }
  return table;
}

const definitionLines = (definition: SchemaTableDefinition): string[] =>
  definition.createSql
    .split("\n")
    .map((line) => line.trim().replace(/,$/u, ""))
    .filter(Boolean);

const extractBacktickColumns = (text: string): string[] => [...text.matchAll(/`([^`]+)`/gu)].map((match) => match[1] ?? "");

export function expectedColumnsFor(definition: SchemaTableDefinition): ExpectedColumn[] {
  return definitionLines(definition)
    .filter((line) => line.startsWith("`"))
    .map((line) => {
      const [name = ""] = extractBacktickColumns(line);
      const normalized = line.toLowerCase();
      const typeMatch = normalized.match(/^`[^`]+`\s+([a-z]+)/u);
      return {
        name,
        nullable: !normalized.includes(" not null"),
        dataTypeHint: typeMatch?.[1] ?? "",
        generated: normalized.includes("generated always"),
        autoIncrement: normalized.includes("auto_increment")
      };
    });
}

export function expectedIndexesFor(definition: SchemaTableDefinition): ExpectedIndex[] {
  const indexes: ExpectedIndex[] = [];
  for (const line of definitionLines(definition)) {
    if (line.startsWith("PRIMARY KEY")) {
      indexes.push({ name: "PRIMARY", columns: extractBacktickColumns(line), unique: true });
      continue;
    }
    const match = line.match(/^(UNIQUE\s+)?KEY\s+`([^`]+)`\s+\((.+)\)$/u);
    if (!match) continue;
    indexes.push({ name: match[2] ?? "", columns: extractBacktickColumns(match[3] ?? ""), unique: Boolean(match[1]) });
  }
  return indexes;
}

export function expectedForeignKeysFor(definition: SchemaTableDefinition): ExpectedForeignKey[] {
  return definitionLines(definition)
    .map((line) => {
      const match = line.match(
        /^CONSTRAINT\s+`([^`]+)`\s+FOREIGN KEY \(`([^`]+)`\) REFERENCES `([^`]+)` \(`([^`]+)`\) ON DELETE ([A-Z ]+) ON UPDATE ([A-Z ]+)$/u
      );
      if (!match) return undefined;
      return {
        name: match[1] ?? "",
        column: match[2] ?? "",
        referencedTable: match[3] ?? "",
        deleteRule: (match[5] ?? "RESTRICT") as ExpectedForeignKey["deleteRule"],
        updateRule: (match[6] ?? "RESTRICT") as ExpectedForeignKey["updateRule"]
      };
    })
    .filter((key): key is ExpectedForeignKey => key !== undefined);
}

export function expectedChecksFor(definition: SchemaTableDefinition): ExpectedCheck[] {
  return definitionLines(definition)
    .map((line) => line.match(/^CONSTRAINT\s+`([^`]+)`\s+CHECK/u)?.[1])
    .filter((name): name is string => typeof name === "string")
    .map((name) => ({ name }));
}

