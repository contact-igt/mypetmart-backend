import type { DatabaseModelRegistry } from "./tables/index.js";

let associationsInitialized = false;

export function initializeDatabaseAssociations(models: DatabaseModelRegistry): void {
  if (associationsInitialized) {
    return;
  }

  const {
    Address,
    AuthSession,
    Cart,
    CartItem,
    Category,
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
    User
  } = models;

  User.hasMany(AuthSession, { foreignKey: "user_id", as: "authSessions" });
  AuthSession.belongsTo(User, { foreignKey: "user_id", as: "user" });

  User.hasMany(Address, { foreignKey: "user_id", as: "addresses" });
  Address.belongsTo(User, { foreignKey: "user_id", as: "user" });

  Category.hasMany(Product, { foreignKey: "category_id", as: "products" });
  Product.belongsTo(Category, { foreignKey: "category_id", as: "category" });

  Product.hasMany(ProductVariant, { foreignKey: "product_id", as: "variants" });
  ProductVariant.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  Product.hasMany(ProductImage, { foreignKey: "product_id", as: "images" });
  ProductImage.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  User.hasMany(Cart, { foreignKey: "user_id", as: "carts" });
  Cart.belongsTo(User, { foreignKey: "user_id", as: "user" });

  Cart.hasMany(CartItem, { foreignKey: "cart_id", as: "items" });
  CartItem.belongsTo(Cart, { foreignKey: "cart_id", as: "cart" });

  Product.hasMany(CartItem, { foreignKey: "product_id", as: "cartItems" });
  CartItem.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  ProductVariant.hasMany(CartItem, { foreignKey: "product_variant_id", as: "cartItems" });
  CartItem.belongsTo(ProductVariant, { foreignKey: "product_variant_id", as: "variant" });

  User.hasMany(Order, { foreignKey: "user_id", as: "orders" });
  Order.belongsTo(User, { foreignKey: "user_id", as: "user" });

  Order.hasMany(OrderItem, { foreignKey: "order_id", as: "items" });
  OrderItem.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  Product.hasMany(OrderItem, { foreignKey: "product_id", as: "orderItems" });
  OrderItem.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  ProductVariant.hasMany(OrderItem, { foreignKey: "product_variant_id", as: "orderItems" });
  OrderItem.belongsTo(ProductVariant, { foreignKey: "product_variant_id", as: "variant" });

  Order.hasMany(OrderNote, { foreignKey: "order_id", as: "notes" });
  OrderNote.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  User.hasMany(OrderNote, { foreignKey: "admin_id", as: "authoredOrderNotes" });
  OrderNote.belongsTo(User, { foreignKey: "admin_id", as: "author" });

  Order.hasMany(Payment, { foreignKey: "order_id", as: "payments" });
  Payment.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  Order.hasMany(Shipment, { foreignKey: "order_id", as: "shipments" });
  Shipment.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  Order.hasMany(ReturnRequest, { foreignKey: "order_id", as: "returns" });
  ReturnRequest.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  OrderItem.hasMany(ReturnRequest, { foreignKey: "order_item_id", as: "returnRequests" });
  ReturnRequest.belongsTo(OrderItem, { foreignKey: "order_item_id", as: "orderItem" });

  User.hasMany(ReturnRequest, { foreignKey: "user_id", as: "returnRequests" });
  ReturnRequest.belongsTo(User, { foreignKey: "user_id", as: "user" });

  ReturnRequest.hasMany(ReturnNote, { foreignKey: "return_request_id", as: "notes" });
  ReturnNote.belongsTo(ReturnRequest, { foreignKey: "return_request_id", as: "returnRequest" });

  User.hasMany(ReturnNote, { foreignKey: "admin_id", as: "authoredReturnNotes" });
  ReturnNote.belongsTo(User, { foreignKey: "admin_id", as: "author" });

  associationsInitialized = true;
}

export function areDatabaseAssociationsInitialized(): boolean {
  return associationsInitialized;
}