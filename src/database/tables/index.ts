import type { Model, ModelStatic, Sequelize } from "sequelize";

import { Address, initializeAddressTable } from "./AddressTable/index.js";
import { AuthSession, initializeAuthSessionTable } from "./AuthSessionTable/index.js";
import { Cart, initializeCartTable } from "./CartTable/index.js";
import { CartItem, initializeCartItemTable } from "./CartItemTable/index.js";
import { Category, initializeCategoryTable } from "./CategoryTable/index.js";
import { ContactEnquiry, initializeContactEnquiryTable } from "./ContactEnquiryTable/index.js";
import { Order, initializeOrderTable } from "./OrderTable/index.js";
import { OrderItem, initializeOrderItemTable } from "./OrderItemTable/index.js";
import { OrderNote, initializeOrderNoteTable } from "./OrderNoteTable/index.js";
import { Payment, initializePaymentTable } from "./PaymentTable/index.js";
import { Product, initializeProductTable } from "./ProductTable/index.js";
import { ProductImage, initializeProductImageTable } from "./ProductImageTable/index.js";
import { ProductVariant, initializeProductVariantTable } from "./ProductVariantTable/index.js";
import { ReturnNote, initializeReturnNoteTable } from "./ReturnNoteTable/index.js";
import { ReturnRequest, initializeReturnRequestTable } from "./ReturnRequestTable/index.js";
import { Shipment, initializeShipmentTable } from "./ShipmentTable/index.js";
import { StoreSetting, initializeStoreSettingTable } from "./StoreSettingTable/index.js";
import { User, initializeUserTable } from "./UserTable/index.js";

export {
  Address,
  AuthSession,
  Cart,
  CartItem,
  Category,
  ContactEnquiry,
  Order,
  OrderItem,
  OrderNote,
  Payment,
  Product,
  ProductImage,
  ProductVariant,
  ReturnNote,
  ReturnRequest,
  Shipment,
  StoreSetting,
  User
};

export const EXPECTED_DATABASE_MODEL_NAMES = [
  "User",
  "AuthSession",
  "Address",
  "Category",
  "Product",
  "ProductVariant",
  "ProductImage",
  "Cart",
  "CartItem",
  "Order",
  "OrderItem",
  "OrderNote",
  "Payment",
  "Shipment",
  "ReturnRequest",
  "ReturnNote",
  "ContactEnquiry",
  "StoreSetting"
] as const;

export type DatabaseModelName = (typeof EXPECTED_DATABASE_MODEL_NAMES)[number];

export type DatabaseModelRegistry = Readonly<{
  User: typeof User;
  AuthSession: typeof AuthSession;
  Address: typeof Address;
  Category: typeof Category;
  Product: typeof Product;
  ProductVariant: typeof ProductVariant;
  ProductImage: typeof ProductImage;
  Cart: typeof Cart;
  CartItem: typeof CartItem;
  Order: typeof Order;
  OrderItem: typeof OrderItem;
  OrderNote: typeof OrderNote;
  Payment: typeof Payment;
  Shipment: typeof Shipment;
  ReturnRequest: typeof ReturnRequest;
  ReturnNote: typeof ReturnNote;
  ContactEnquiry: typeof ContactEnquiry;
  StoreSetting: typeof StoreSetting;
}>;

let initializedRegistry: DatabaseModelRegistry | undefined;

export function initializeDatabaseModels(sequelize: Sequelize): DatabaseModelRegistry {
  if (initializedRegistry !== undefined) {
    return initializedRegistry;
  }

  initializeUserTable(sequelize);
  initializeAuthSessionTable(sequelize);
  initializeAddressTable(sequelize);
  initializeCategoryTable(sequelize);
  initializeProductTable(sequelize);
  initializeProductVariantTable(sequelize);
  initializeProductImageTable(sequelize);
  initializeCartTable(sequelize);
  initializeCartItemTable(sequelize);
  initializeOrderTable(sequelize);
  initializeOrderItemTable(sequelize);
  initializeOrderNoteTable(sequelize);
  initializePaymentTable(sequelize);
  initializeShipmentTable(sequelize);
  initializeReturnRequestTable(sequelize);
  initializeReturnNoteTable(sequelize);
  initializeContactEnquiryTable(sequelize);
  initializeStoreSettingTable(sequelize);

  initializedRegistry = Object.freeze({
    User,
    AuthSession,
    Address,
    Category,
    Product,
    ProductVariant,
    ProductImage,
    Cart,
    CartItem,
    Order,
    OrderItem,
    OrderNote,
    Payment,
    Shipment,
    ReturnRequest,
    ReturnNote,
    ContactEnquiry,
    StoreSetting
  });

  return initializedRegistry;
}

export function getInitializedDatabaseModels(): DatabaseModelRegistry {
  if (initializedRegistry === undefined) {
    throw new Error("Database models have not been initialized.");
  }

  return initializedRegistry;
}

export function getModelList(registry: DatabaseModelRegistry): ReadonlyArray<ModelStatic<Model>> {
  return EXPECTED_DATABASE_MODEL_NAMES.map((modelName) => registry[modelName]);
}