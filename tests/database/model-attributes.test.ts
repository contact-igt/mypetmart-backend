import { DataTypes } from "sequelize";
import type { Model, ModelStatic } from "sequelize";
import { describe, expect, it } from "vitest";

import {
  CART_STATUS_VALUES,
  CONTACT_ENQUIRY_STATUS_VALUES,
  DEFAULT_COUNTRY_CODE,
  DEFAULT_CURRENCY_CODE,
  FULFILMENT_STATUS_VALUES,
  MONEY_PRECISION,
  MONEY_SCALE,
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
} from "../../src/constants/database.constants.js";
import { databaseModels } from "../../src/database/index.js";
import { getModelList } from "../../src/database/tables/index.js";

type AttributeMetadata = Record<string, unknown>;
type IndexMetadata = Record<string, unknown>;

const modelRegistry = databaseModels as unknown as Record<string, ModelStatic<Model>>;

function model(modelName: keyof typeof databaseModels): ModelStatic<Model> {
  const resolvedModel = modelRegistry[modelName];
  if (resolvedModel === undefined) {
    throw new Error(`${String(modelName)} is missing.`);
  }

  return resolvedModel;
}

function attribute(modelName: keyof typeof databaseModels, attributeName: string): AttributeMetadata {
  const attr = model(modelName).getAttributes()[attributeName] as unknown;
  if (attr === undefined) {
    throw new Error(`${String(modelName)}.${attributeName} is missing.`);
  }

  return attr as AttributeMetadata;
}

function indexMetadata(modelName: keyof typeof databaseModels): IndexMetadata[] {
  return (model(modelName).options.indexes ?? []) as unknown as IndexMetadata[];
}

function indexNames(modelName: keyof typeof databaseModels): string[] {
  return indexMetadata(modelName).map((index) => (typeof index.name === "string" ? index.name : ""));
}

function indexByName(modelName: keyof typeof databaseModels, name: string): IndexMetadata | undefined {
  return indexMetadata(modelName).find((index) => index.name === name);
}

function toSql(attributeType: unknown): string {
  if (typeof attributeType !== "object" || attributeType === null || !("toSql" in attributeType)) {
    throw new Error("Attribute type cannot be converted to SQL.");
  }

  const toSqlFn = attributeType.toSql;
  if (typeof toSqlFn !== "function") {
    throw new Error("Attribute type toSql is not callable.");
  }

  return String(toSqlFn.call(attributeType));
}

describe("database model attributes and indexes", () => {
  it("defines primary keys, timestamps and paranoid policy", () => {
    for (const registeredModel of getModelList(databaseModels)) {
      const idAttribute = registeredModel.getAttributes().id;
      expect(idAttribute?.primaryKey).toBe(true);
      expect(idAttribute?.allowNull).toBe(false);
      expect(idAttribute?.unique).toBe(true);
      expect(registeredModel.options.timestamps).toBe(true);
      expect(registeredModel.options.createdAt).toBe("created_at");
      expect(registeredModel.options.updatedAt).toBe("updated_at");
    }

    for (const modelName of ["User", "Address", "Category", "Product", "ProductVariant", "ProductImage", "MediaAsset"] as const) {
      expect(databaseModels[modelName].options.paranoid).toBe(true);
      expect(databaseModels[modelName].options.deletedAt).toBe("deleted_at");
    }

    for (const modelName of ["AuthSession", "Cart", "CartItem", "Order", "OrderItem", "OrderNote", "Payment", "Shipment", "ReturnRequest", "ReturnNote", "ContactEnquiry", "StoreSetting"] as const) {
      expect(databaseModels[modelName].options.paranoid).toBe(false);
    }
  });

  it("uses canonical enum constants and documented defaults", () => {
    expect(attribute("User", "role").values).toEqual([...USER_ROLE_VALUES]);
    expect(attribute("User", "role").defaultValue).toBe("customer");
    expect(attribute("User", "status").values).toEqual([...USER_STATUS_VALUES]);
    expect(attribute("User", "status").defaultValue).toBe("active");
    expect(attribute("AuthSession", "session_type").values).toEqual([...SESSION_TYPE_VALUES]);
    expect(attribute("Category", "pet_type").values).toEqual([...PET_TYPE_VALUES]);
    expect(attribute("Product", "status").values).toEqual([...PRODUCT_STATUS_VALUES]);
    expect(attribute("Product", "status").defaultValue).toBe("draft");
    expect(attribute("Cart", "status").values).toEqual([...CART_STATUS_VALUES]);
    expect(attribute("Order", "status").values).toEqual([...ORDER_STATUS_VALUES]);
    expect(attribute("Order", "payment_status").values).toEqual([...PAYMENT_STATUS_VALUES]);
    expect(attribute("Order", "fulfilment_status").values).toEqual([...FULFILMENT_STATUS_VALUES]);
    expect(attribute("Shipment", "method").values).toEqual([...SHIPPING_METHOD_VALUES]);
    expect(attribute("Shipment", "status").values).toEqual([...SHIPMENT_STATUS_VALUES]);
    expect(attribute("ReturnRequest", "type").values).toEqual([...RETURN_TYPE_VALUES]);
    expect(attribute("ReturnRequest", "status").values).toEqual([...RETURN_STATUS_VALUES]);
    expect(attribute("ContactEnquiry", "status").values).toEqual([...CONTACT_ENQUIRY_STATUS_VALUES]);
  });

  it("defines critical field types, lengths and nullability", () => {
    expect(attribute("User", "email").type).toBeInstanceOf(DataTypes.STRING);
    expect(attribute("User", "email").allowNull).toBe(false);
    expect(attribute("User", "phone").allowNull).toBe(true);
    expect(attribute("AuthSession", "user_id").allowNull).toBe(false);
    expect(attribute("Address", "country").defaultValue).toBe(DEFAULT_COUNTRY_CODE);
    expect(attribute("Address", "is_default").defaultValue).toBe(false);
    expect(attribute("Product", "category_id").allowNull).toBe(false);
    expect(attribute("Product", "tags").type).toBeInstanceOf(DataTypes.JSON);
    expect(attribute("Product", "has_variants").defaultValue).toBe(false);
    expect(attribute("ProductVariant", "active").defaultValue).toBe(true);
    expect(attribute("ProductImage", "size_bytes").allowNull).toBe(true);
    expect(attribute("ProductImage", "is_primary").defaultValue).toBe(false);
    expect(attribute("Cart", "user_id").allowNull).toBe(true);
    expect(attribute("Cart", "guest_token_hash").allowNull).toBe(true);
    expect(attribute("CartItem", "product_variant_id").allowNull).toBe(true);
    expect(attribute("Order", "currency").defaultValue).toBe(DEFAULT_CURRENCY_CODE);
    expect(attribute("Order", "ship_country").defaultValue).toBe(DEFAULT_COUNTRY_CODE);
    expect(attribute("OrderItem", "product_id").allowNull).toBe(true);
    expect(attribute("Payment", "raw_payload").type).toBeInstanceOf(DataTypes.JSON);
    expect(attribute("Shipment", "raw_payload").type).toBeInstanceOf(DataTypes.JSON);
    expect(attribute("ReturnRequest", "evidence_image_url").allowNull).toBe(true);
    expect(attribute("StoreSetting", "setting_value").type).toBeInstanceOf(DataTypes.JSON);
  });

  it("defines decimal precision and scale for money fields", () => {
    for (const [modelName, fields] of [
      ["Product", ["price", "compare_at_price"]],
      ["ProductVariant", ["price", "compare_at_price"]],
      ["CartItem", ["unit_price_snapshot"]],
      ["Order", ["subtotal", "shipping_fee", "total"]],
      ["OrderItem", ["unit_price", "line_total"]],
      ["Payment", ["amount"]]
    ] as const) {
      for (const field of fields) {
        expect(toSql(attribute(modelName, field).type)).toBe(`DECIMAL(${MONEY_PRECISION},${MONEY_SCALE})`);
      }
    }
  });

  it("defines required unique and query indexes without unsafe nullable uniqueness", () => {
    expect(indexNames("User")).toContain("users_email_unique");
    expect(indexByName("User", "users_email_unique")?.unique).toBe(true);
    expect(indexByName("Product", "products_slug_unique")?.unique).toBe(true);
    expect(indexByName("Product", "products_sku_unique")?.unique).toBe(true);
    expect(indexByName("ProductVariant", "product_variants_sku_unique")?.unique).toBe(true);
    expect(indexByName("Order", "orders_order_number_unique")?.unique).toBe(true);
    expect(indexByName("ProductImage", "product_images_r2_key_unique")?.unique).toBe(true);
    expect(indexByName("StoreSetting", "store_settings_setting_key_unique")?.unique).toBe(true);
    expect(indexNames("Product")).toContain("products_category_status_idx");
    expect(indexNames("Product")).toContain("products_pet_type_status_idx");
    expect(indexNames("CartItem")).toContain("cart_items_cart_product_variant_idx");
    expect(indexByName("CartItem", "cart_items_cart_product_variant_idx")?.unique).not.toBe(true);
    expect(indexByName("ProductImage", "product_images_product_primary_idx")?.unique).not.toBe(true);
  });
});