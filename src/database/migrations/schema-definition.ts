import {
  AUTH_CHALLENGE_PURPOSE_VALUES,
  CART_STATUS_VALUES,
  CONTACT_ENQUIRY_STATUS_VALUES,
  DATABASE_TABLE_NAMES,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_CURRENCY_CODE,
  FULFILMENT_STATUS_VALUES,
  MEDIA_ASSET_TYPE_VALUES,
  NEWSLETTER_SUBSCRIBER_STATUS_VALUES,
  PRODUCT_MEDIA_ROLE_VALUES,
  PRODUCT_CONTENT_LAYOUT_VALUES,
  REVIEW_STATUS_VALUES,
  REVIEW_SOURCE_VALUES,
  NOTIFICATION_ENTITY_TYPE_VALUES,
  NOTIFICATION_EVENT_TYPE_VALUES,
  NOTIFICATION_STATUS_VALUES,
  ORDER_COMMERCE_EXCEPTION_VALUES,
  ORDER_STATUS_VALUES,
  PAYMENT_STATUS_VALUES,
  PET_TYPE_VALUES,
  PRODUCT_STATUS_VALUES,
  REPLACEMENT_STATUS_VALUES,
  REFUND_STATUS_VALUES,
  RETURN_STATUS_VALUES,
  RETURN_TYPE_VALUES,
  SESSION_TYPE_VALUES,
  SHIPMENT_SOURCE_TYPE_VALUES,
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
        \`latitude\` DECIMAL(9,6) NULL,
        \`longitude\` DECIMAL(10,6) NULL,
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
        CONSTRAINT \`fk_addresses_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_addresses_latitude_range\` CHECK (\`latitude\` IS NULL OR (\`latitude\` >= -90 AND \`latitude\` <= 90)),
        CONSTRAINT \`chk_addresses_longitude_range\` CHECK (\`longitude\` IS NULL OR (\`longitude\` >= -180 AND \`longitude\` <= 180)),
        CONSTRAINT \`chk_addresses_coord_pair\` CHECK ((\`latitude\` IS NULL AND \`longitude\` IS NULL) OR (\`latitude\` IS NOT NULL AND \`longitude\` IS NOT NULL))
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
        \`show_on_homepage\` TINYINT(1) NOT NULL DEFAULT 0,
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
        \`brand\` VARCHAR(120) NULL,
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
        \`how_to_use\` TEXT NULL,
        \`care_instructions\` TEXT NULL,
        \`safety_info\` TEXT NULL,
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
        \`media_asset_id\` INT UNSIGNED NULL,
        \`r2_key\` VARCHAR(512) NULL,
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
        KEY \`product_images_media_asset_id_idx\` (\`media_asset_id\`),
        KEY \`product_images_deleted_at_idx\` (\`deleted_at\`),
        CONSTRAINT \`fk_product_images_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_product_images_size_nonnegative\` CHECK (\`size_bytes\` IS NULL OR \`size_bytes\` >= 0),
        CONSTRAINT \`chk_product_images_width_nonnegative\` CHECK (\`width\` IS NULL OR \`width\` >= 0),
        CONSTRAINT \`chk_product_images_height_nonnegative\` CHECK (\`height\` IS NULL OR \`height\` >= 0),
        CONSTRAINT \`chk_product_images_sort_order_nonnegative\` CHECK (\`sort_order\` >= 0)
      ) ${engine};
    `
    // NOTE: media_asset_id is a plain nullable column + index here (no FK in
    // this text) even though it references media_assets.id. media_assets is
    // migration 041 — created AFTER this table (migration 007) — so a FK
    // clause baked into this CREATE TABLE text would break fresh installs
    // (product_images would be created before media_assets exists). The real
    // FK constraint is instead added by migration 042, once media_assets
    // exists, and is enforced by MySQL even though db:schema:verify (which
    // reads only this text) does not check for it. r2_key is nullable
    // because a Product Image attached from the Media Gallery shares its R2
    // object with every other Product that reuses the same asset — it
    // deliberately does NOT own a unique r2_key of its own (its url is
    // copied from the Media Asset instead). MySQL's UNIQUE KEY permits
    // unlimited NULLs, so this coexists safely with directly-uploaded
    // Product Images, which still each own a distinct, unique r2_key.
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
        \`user_id\` INT UNSIGNED NULL,
        \`guest_identity_hash\` VARCHAR(255) NULL,
        \`guest_access_token_hash\` VARCHAR(255) NULL,
        \`cart_id\` INT UNSIGNED NULL,
        \`status\` ${enumSql(ORDER_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`payment_status\` ${enumSql(PAYMENT_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`fulfilment_status\` ${enumSql(FULFILMENT_STATUS_VALUES)} NOT NULL DEFAULT 'unfulfilled',
        \`commerce_exception\` ${enumSql(ORDER_COMMERCE_EXCEPTION_VALUES)} NULL,
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
        \`ship_latitude\` DECIMAL(9,6) NULL,
        \`ship_longitude\` DECIMAL(10,6) NULL,
        \`placed_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`cancelled_at\` DATETIME NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`orders_order_number_unique\` (\`order_number\`),
        UNIQUE KEY \`orders_guest_access_token_hash_unique\` (\`guest_access_token_hash\`),
        KEY \`orders_guest_identity_status_idx\` (\`guest_identity_hash\`, \`status\`),
        KEY \`orders_user_placed_idx\` (\`user_id\`, \`placed_at\`),
        KEY \`orders_status_placed_idx\` (\`status\`, \`placed_at\`),
        KEY \`orders_payment_status_idx\` (\`payment_status\`),
        KEY \`orders_fulfilment_status_idx\` (\`fulfilment_status\`),
        KEY \`orders_ship_state_city_idx\` (\`ship_state\`, \`ship_city\`),
        KEY \`orders_cart_id_idx\` (\`cart_id\`),
        KEY \`orders_commerce_exception_idx\` (\`commerce_exception\`),
        CONSTRAINT \`fk_orders_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_orders_cart_id\` FOREIGN KEY (\`cart_id\`) REFERENCES \`carts\` (\`id\`) ON DELETE SET NULL ON UPDATE RESTRICT,
        CONSTRAINT \`chk_orders_subtotal_nonnegative\` CHECK (\`subtotal\` >= 0),
        CONSTRAINT \`chk_orders_shipping_fee_nonnegative\` CHECK (\`shipping_fee\` >= 0),
        CONSTRAINT \`chk_orders_total_nonnegative\` CHECK (\`total\` >= 0),
        CONSTRAINT \`chk_orders_ship_latitude_range\` CHECK (\`ship_latitude\` IS NULL OR (\`ship_latitude\` >= -90 AND \`ship_latitude\` <= 90)),
        CONSTRAINT \`chk_orders_ship_longitude_range\` CHECK (\`ship_longitude\` IS NULL OR (\`ship_longitude\` >= -180 AND \`ship_longitude\` <= 180)),
        CONSTRAINT \`chk_orders_ship_coord_pair\` CHECK ((\`ship_latitude\` IS NULL AND \`ship_longitude\` IS NULL) OR (\`ship_latitude\` IS NOT NULL AND \`ship_longitude\` IS NOT NULL))
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
        \`shipment_number\` VARCHAR(50) NOT NULL,
        \`source_type\` ${enumSql(SHIPMENT_SOURCE_TYPE_VALUES)} NOT NULL,
        \`source_id\` INT UNSIGNED NOT NULL,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`replacement_id\` INT UNSIGNED NULL,
        \`method\` ${enumSql(SHIPPING_METHOD_VALUES)} NOT NULL DEFAULT 'standard',
        \`provider\` VARCHAR(50) NOT NULL DEFAULT 'ithink',
        \`provider_order_id\` VARCHAR(190) NULL,
        \`carrier\` VARCHAR(120) NULL,
        \`tracking_number\` VARCHAR(120) NULL,
        \`service_type\` VARCHAR(80) NULL,
        \`status\` ${enumSql(SHIPMENT_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`provider_status\` VARCHAR(120) NULL,
        \`provider_status_code\` VARCHAR(80) NULL,
        \`pickup_warehouse_id\` VARCHAR(80) NOT NULL,
        \`weight_grams\` INT UNSIGNED NOT NULL,
        \`length_cm\` DECIMAL(8,2) NOT NULL,
        \`width_cm\` DECIMAL(8,2) NOT NULL,
        \`height_cm\` DECIMAL(8,2) NOT NULL,
        \`shipping_charge\` DECIMAL(10,2) NULL,
        \`currency\` CHAR(3) NOT NULL DEFAULT '${DEFAULT_CURRENCY_CODE}',
        \`shipped_at\` DATETIME NULL,
        \`delivered_at\` DATETIME NULL,
        \`cancelled_at\` DATETIME NULL,
        \`rto_at\` DATETIME NULL,
        \`last_synced_at\` DATETIME NULL,
        \`provider_shipment_id\` VARCHAR(190) NULL,
        \`raw_payload\` JSON NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`shipments_number_unique\` (\`shipment_number\`),
        UNIQUE KEY \`shipments_source_unique\` (\`source_type\`, \`source_id\`),
        UNIQUE KEY \`shipments_replacement_id_unique\` (\`replacement_id\`),
        UNIQUE KEY \`shipments_provider_order_id_unique\` (\`provider_order_id\`),
        UNIQUE KEY \`shipments_provider_shipment_id_unique\` (\`provider_shipment_id\`),
        UNIQUE KEY \`shipments_tracking_number_unique\` (\`tracking_number\`),
        KEY \`shipments_order_id_idx\` (\`order_id\`),
        KEY \`shipments_status_idx\` (\`status\`),
        CONSTRAINT \`fk_shipments_order_id\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_shipments_replacement_id\` FOREIGN KEY (\`replacement_id\`) REFERENCES \`replacements\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_shipments_source\` CHECK ((\`source_type\` = 'order' AND \`source_id\` = \`order_id\` AND \`replacement_id\` IS NULL) OR (\`source_type\` = 'replacement' AND \`source_id\` = \`replacement_id\` AND \`replacement_id\` IS NOT NULL)),
        CONSTRAINT \`chk_shipments_weight_positive\` CHECK (\`weight_grams\` > 0),
        CONSTRAINT \`chk_shipments_dimensions_positive\` CHECK (\`length_cm\` > 0 AND \`width_cm\` > 0 AND \`height_cm\` > 0),
        CONSTRAINT \`chk_shipments_charge_nonnegative\` CHECK (\`shipping_charge\` IS NULL OR \`shipping_charge\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.shipmentTrackingEvents,
    migrationName: "040-create-shipment-tracking-events",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.shipmentTrackingEvents)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`shipment_id\` INT UNSIGNED NOT NULL,
        \`dedupe_key\` CHAR(64) NOT NULL,
        \`provider_status\` VARCHAR(120) NOT NULL,
        \`provider_status_code\` VARCHAR(80) NULL,
        \`normalized_status\` ${enumSql(SHIPMENT_STATUS_VALUES)} NOT NULL,
        \`location\` VARCHAR(255) NULL,
        \`message\` VARCHAR(1000) NULL,
        \`event_at\` DATETIME NOT NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`shipment_events_dedupe_unique\` (\`shipment_id\`, \`dedupe_key\`),
        KEY \`shipment_events_timeline_idx\` (\`shipment_id\`, \`event_at\`),
        CONSTRAINT \`fk_shipment_events_shipment_id\` FOREIGN KEY (\`shipment_id\`) REFERENCES \`shipments\` (\`id\`) ON DELETE CASCADE ON UPDATE RESTRICT
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
        \`quantity\` INT UNSIGNED NOT NULL,
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
        CONSTRAINT \`fk_return_requests_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_return_requests_quantity_positive\` CHECK (\`quantity\` > 0)
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
        \`order_number\` VARCHAR(50) NULL,
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
  },
  {
    tableName: DATABASE_TABLE_NAMES.wishlists,
    migrationName: "027-create-wishlists",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.wishlists)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`user_id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`wishlists_user_product_unique\` (\`user_id\`, \`product_id\`),
        KEY \`wishlists_user_id_idx\` (\`user_id\`),
        KEY \`wishlists_product_id_idx\` (\`product_id\`),
        CONSTRAINT \`fk_wishlists_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_wishlists_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.refunds,
    migrationName: "035-create-refunds",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.refunds)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`refund_number\` VARCHAR(50) NOT NULL,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`payment_id\` INT UNSIGNED NOT NULL,
        \`return_request_id\` INT UNSIGNED NULL,
        \`provider\` VARCHAR(80) NOT NULL,
        \`provider_refund_token\` VARCHAR(190) NOT NULL,
        \`provider_request_id\` VARCHAR(190) NULL,
        \`provider_refund_id\` VARCHAR(190) NULL,
        \`provider_status\` VARCHAR(80) NULL,
        \`status\` ${enumSql(REFUND_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`amount\` DECIMAL(10,2) NOT NULL,
        \`currency\` VARCHAR(3) NOT NULL DEFAULT 'INR',
        \`failure_code\` VARCHAR(120) NULL,
        \`failure_message\` VARCHAR(500) NULL,
        \`initiated_by_admin_id\` INT UNSIGNED NOT NULL,
        \`initiated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        \`completed_at\` DATETIME NULL,
        \`failed_at\` DATETIME NULL,
        \`raw_payload\` JSON NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`refunds_refund_number_unique\` (\`refund_number\`),
        UNIQUE KEY \`refunds_provider_refund_token_unique\` (\`provider_refund_token\`),
        UNIQUE KEY \`refunds_provider_refund_id_unique\` (\`provider_refund_id\`),
        KEY \`refunds_order_id_idx\` (\`order_id\`),
        KEY \`refunds_payment_id_idx\` (\`payment_id\`),
        KEY \`refunds_return_request_id_idx\` (\`return_request_id\`),
        KEY \`refunds_status_idx\` (\`status\`),
        KEY \`refunds_initiated_by_admin_id_idx\` (\`initiated_by_admin_id\`),
        CONSTRAINT \`fk_refunds_order_id\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_refunds_payment_id\` FOREIGN KEY (\`payment_id\`) REFERENCES \`payments\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_refunds_return_request_id\` FOREIGN KEY (\`return_request_id\`) REFERENCES \`return_requests\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_refunds_initiated_by_admin_id\` FOREIGN KEY (\`initiated_by_admin_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_refunds_amount_positive\` CHECK (\`amount\` > 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.replacements,
    migrationName: "038-create-replacements",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.replacements)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`replacement_number\` VARCHAR(50) NOT NULL,
        \`return_request_id\` INT UNSIGNED NOT NULL,
        \`order_id\` INT UNSIGNED NOT NULL,
        \`order_item_id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`product_variant_id\` INT UNSIGNED NULL,
        \`quantity\` INT UNSIGNED NOT NULL,
        \`status\` ${enumSql(REPLACEMENT_STATUS_VALUES)} NOT NULL,
        \`approved_by_admin_id\` INT UNSIGNED NOT NULL,
        \`stock_consumed_at\` DATETIME NULL,
        \`completed_at\` DATETIME NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`replacements_number_unique\` (\`replacement_number\`),
        UNIQUE KEY \`replacements_return_request_unique\` (\`return_request_id\`),
        KEY \`replacements_order_id_idx\` (\`order_id\`),
        KEY \`replacements_order_item_id_idx\` (\`order_item_id\`),
        KEY \`replacements_product_id_idx\` (\`product_id\`),
        KEY \`replacements_variant_id_idx\` (\`product_variant_id\`),
        KEY \`replacements_status_idx\` (\`status\`),
        CONSTRAINT \`fk_replacements_return_request_id\` FOREIGN KEY (\`return_request_id\`) REFERENCES \`return_requests\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_replacements_order_id\` FOREIGN KEY (\`order_id\`) REFERENCES \`orders\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_replacements_order_item_id\` FOREIGN KEY (\`order_item_id\`) REFERENCES \`order_items\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_replacements_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_replacements_variant_id\` FOREIGN KEY (\`product_variant_id\`) REFERENCES \`product_variants\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_replacements_admin_id\` FOREIGN KEY (\`approved_by_admin_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_replacements_quantity_positive\` CHECK (\`quantity\` > 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.mediaAssets,
    migrationName: "041-create-media-assets",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.mediaAssets)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`file_name\` VARCHAR(255) NOT NULL,
        \`original_name\` VARCHAR(255) NOT NULL,
        \`storage_key\` VARCHAR(512) NOT NULL,
        \`public_url\` VARCHAR(1000) NOT NULL,
        \`mime_type\` VARCHAR(100) NOT NULL,
        \`media_type\` ${enumSql(MEDIA_ASSET_TYPE_VALUES)} NOT NULL DEFAULT 'image',
        \`file_size\` INT UNSIGNED NOT NULL,
        \`width\` INT UNSIGNED NULL,
        \`height\` INT UNSIGNED NULL,
        \`alt_text\` VARCHAR(255) NULL,
        \`title\` VARCHAR(190) NULL,
        \`uploaded_by\` INT UNSIGNED NOT NULL,
        ${createdUpdated},
        ${deletedAt},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`media_assets_storage_key_unique\` (\`storage_key\`),
        KEY \`media_assets_uploaded_by_idx\` (\`uploaded_by\`),
        KEY \`media_assets_media_type_idx\` (\`media_type\`),
        KEY \`media_assets_created_at_idx\` (\`created_at\`),
        KEY \`media_assets_deleted_at_idx\` (\`deleted_at\`),
        CONSTRAINT \`fk_media_assets_uploaded_by\` FOREIGN KEY (\`uploaded_by\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_media_assets_file_size_nonnegative\` CHECK (\`file_size\` >= 0),
        CONSTRAINT \`chk_media_assets_width_nonnegative\` CHECK (\`width\` IS NULL OR \`width\` >= 0),
        CONSTRAINT \`chk_media_assets_height_nonnegative\` CHECK (\`height\` IS NULL OR \`height\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.newsletterSubscribers,
    migrationName: "044-create-newsletter-subscribers",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.newsletterSubscribers)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`email\` VARCHAR(190) NOT NULL,
        \`normalized_email\` VARCHAR(190) NOT NULL,
        \`status\` ${enumSql(NEWSLETTER_SUBSCRIBER_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`source\` VARCHAR(100) NULL,
        \`verification_token_hash\` VARCHAR(64) NULL,
        \`verification_expires_at\` DATETIME NULL,
        \`verification_sent_at\` DATETIME NULL,
        \`verified_at\` DATETIME NULL,
        \`unsubscribe_token_hash\` VARCHAR(64) NULL,
        \`unsubscribed_at\` DATETIME NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`newsletter_subscribers_normalized_email_unique\` (\`normalized_email\`),
        UNIQUE KEY \`newsletter_subscribers_verification_token_hash_unique\` (\`verification_token_hash\`),
        UNIQUE KEY \`newsletter_subscribers_unsubscribe_token_hash_unique\` (\`unsubscribe_token_hash\`),
        KEY \`newsletter_subscribers_status_idx\` (\`status\`),
        KEY \`newsletter_subscribers_created_at_idx\` (\`created_at\`)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.notificationLog,
    migrationName: "045-create-notification-log",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.notificationLog)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`event_type\` ${enumSql(NOTIFICATION_EVENT_TYPE_VALUES)} NOT NULL,
        \`entity_type\` ${enumSql(NOTIFICATION_ENTITY_TYPE_VALUES)} NOT NULL,
        \`entity_id\` INT UNSIGNED NOT NULL,
        \`recipient_email\` VARCHAR(190) NOT NULL,
        \`status\` ${enumSql(NOTIFICATION_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`error_message\` VARCHAR(500) NULL,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`notification_log_event_entity_unique\` (\`event_type\`, \`entity_type\`, \`entity_id\`),
        KEY \`notification_log_status_idx\` (\`status\`),
        KEY \`notification_log_created_at_idx\` (\`created_at\`)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.productFeatures,
    migrationName: "048-create-product-features",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.productFeatures)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`label\` VARCHAR(120) NOT NULL,
        \`display_order\` INT NOT NULL DEFAULT 0,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        KEY \`product_features_product_order_idx\` (\`product_id\`, \`display_order\`),
        CONSTRAINT \`fk_product_features_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_product_features_display_order_nonnegative\` CHECK (\`display_order\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.productReviews,
    migrationName: "054-create-product-reviews",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.productReviews)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`user_id\` INT UNSIGNED NULL,
        \`order_item_id\` INT UNSIGNED NULL,
        \`rating\` TINYINT UNSIGNED NOT NULL,
        \`title\` VARCHAR(160) NULL,
        \`review\` TEXT NOT NULL,
        \`status\` ${enumSql(REVIEW_STATUS_VALUES)} NOT NULL DEFAULT 'pending',
        \`verified_purchase\` TINYINT(1) NOT NULL DEFAULT 1,
        \`customer_name\` VARCHAR(120) NULL,
        \`review_source\` ${enumSql(REVIEW_SOURCE_VALUES)} NOT NULL DEFAULT 'customer',
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`product_reviews_user_product_unique\` (\`user_id\`, \`product_id\`),
        KEY \`product_reviews_product_status_created_idx\` (\`product_id\`, \`status\`, \`created_at\`),
        KEY \`product_reviews_status_idx\` (\`status\`),
        KEY \`product_reviews_order_item_id_idx\` (\`order_item_id\`),
        CONSTRAINT \`fk_product_reviews_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_product_reviews_user_id\` FOREIGN KEY (\`user_id\`) REFERENCES \`users\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_product_reviews_order_item_id\` FOREIGN KEY (\`order_item_id\`) REFERENCES \`order_items\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_product_reviews_rating_range\` CHECK (\`rating\` BETWEEN 1 AND 5)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.productContentBlocks,
    migrationName: "053-create-product-content-blocks",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.productContentBlocks)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`media_asset_id\` INT UNSIGNED NULL,
        \`heading\` VARCHAR(160) NULL,
        \`description\` TEXT NULL,
        \`layout\` ${enumSql(PRODUCT_CONTENT_LAYOUT_VALUES)} NOT NULL DEFAULT 'media_left',
        \`display_order\` INT NOT NULL DEFAULT 0,
        \`active\` TINYINT(1) NOT NULL DEFAULT 1,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        KEY \`product_content_blocks_product_order_idx\` (\`product_id\`, \`display_order\`),
        KEY \`product_content_blocks_media_asset_id_idx\` (\`media_asset_id\`),
        CONSTRAINT \`fk_product_content_blocks_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_product_content_blocks_media_asset_id\` FOREIGN KEY (\`media_asset_id\`) REFERENCES \`media_assets\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_product_content_blocks_display_order_nonnegative\` CHECK (\`display_order\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.productSpecifications,
    migrationName: "051-create-product-specifications",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.productSpecifications)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`label\` VARCHAR(80) NOT NULL,
        \`value\` VARCHAR(200) NOT NULL,
        \`display_order\` INT NOT NULL DEFAULT 0,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`product_specifications_product_label_unique\` (\`product_id\`, \`label\`),
        KEY \`product_specifications_product_order_idx\` (\`product_id\`, \`display_order\`),
        CONSTRAINT \`fk_product_specifications_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_product_specifications_display_order_nonnegative\` CHECK (\`display_order\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.productFaqs,
    migrationName: "055-create-product-faqs",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.productFaqs)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`question\` VARCHAR(200) NOT NULL,
        \`answer\` TEXT NOT NULL,
        \`display_order\` INT NOT NULL DEFAULT 0,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        KEY \`product_faqs_product_order_idx\` (\`product_id\`, \`display_order\`),
        CONSTRAINT \`fk_product_faqs_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_product_faqs_display_order_nonnegative\` CHECK (\`display_order\` >= 0)
      ) ${engine};
    `
  },
  {
    tableName: DATABASE_TABLE_NAMES.productMediaAssignments,
    migrationName: "050-create-product-media-assignments",
    createSql: `
      CREATE TABLE ${q(DATABASE_TABLE_NAMES.productMediaAssignments)} (
        \`id\` INT UNSIGNED NOT NULL,
        \`product_id\` INT UNSIGNED NOT NULL,
        \`media_asset_id\` INT UNSIGNED NOT NULL,
        \`media_role\` ${enumSql(PRODUCT_MEDIA_ROLE_VALUES)} NOT NULL,
        \`title\` VARCHAR(190) NULL,
        \`caption\` VARCHAR(500) NULL,
        \`display_order\` INT NOT NULL DEFAULT 0,
        \`active\` TINYINT(1) NOT NULL DEFAULT 1,
        ${createdUpdated},
        PRIMARY KEY (\`id\`),
        KEY \`product_media_assignments_product_role_order_idx\` (\`product_id\`, \`media_role\`, \`display_order\`),
        KEY \`product_media_assignments_media_asset_id_idx\` (\`media_asset_id\`),
        CONSTRAINT \`fk_product_media_assignments_product_id\` FOREIGN KEY (\`product_id\`) REFERENCES \`products\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`fk_product_media_assignments_media_asset_id\` FOREIGN KEY (\`media_asset_id\`) REFERENCES \`media_assets\` (\`id\`) ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT \`chk_product_media_assignments_display_order_nonnegative\` CHECK (\`display_order\` >= 0)
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

