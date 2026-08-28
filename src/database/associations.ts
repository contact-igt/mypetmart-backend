import type { DatabaseModelRegistry } from "./tables/index.js";

let associationsInitialized = false;

export function initializeDatabaseAssociations(models: DatabaseModelRegistry): void {
  if (associationsInitialized) {
    return;
  }

  const {
    Address,
    AuthChallenge,
    AuthSession,
    Cart,
    CartItem,
    Category,
    MediaAsset,
    Order,
    OrderDocument,
    OrderItem,
    OrderNote,
    PasswordResetToken,
    Payment,
    Product,
    ProductContentBlock,
    ProductFaq,
    ProductFeature,
    ProductImage,
    ProductMediaAssignment,
    ProductReview,
    ProductSpecification,
    ProductVariant,
    Replacement,
    Refund,
    ReturnNote,
    ReturnRequest,
    ReturnShipment,
    ReturnShipmentTrackingEvent,
    Shipment,
    ShipmentTrackingEvent,
    User,
    Wishlist
  } = models;

  User.hasMany(AuthChallenge, { foreignKey: "user_id", as: "authChallenges" });
  AuthChallenge.belongsTo(User, { foreignKey: "user_id", as: "user" });

  User.hasMany(PasswordResetToken, { foreignKey: "user_id", as: "passwordResetTokens" });
  PasswordResetToken.belongsTo(User, { foreignKey: "user_id", as: "user" });

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

  Product.hasMany(ProductFeature, { foreignKey: "product_id", as: "features" });
  ProductFeature.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  Product.hasMany(ProductSpecification, { foreignKey: "product_id", as: "specifications" });
  ProductSpecification.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  Product.hasMany(ProductContentBlock, { foreignKey: "product_id", as: "contentBlocks" });
  ProductContentBlock.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  Product.hasMany(ProductFaq, { foreignKey: "product_id", as: "faqs" });
  ProductFaq.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  User.hasMany(MediaAsset, { foreignKey: "uploaded_by", as: "uploadedMediaAssets" });
  MediaAsset.belongsTo(User, { foreignKey: "uploaded_by", as: "uploadedBy" });

  MediaAsset.hasMany(ProductImage, { foreignKey: "media_asset_id", as: "productImages" });
  ProductImage.belongsTo(MediaAsset, { foreignKey: "media_asset_id", as: "mediaAsset" });

  Product.hasMany(ProductMediaAssignment, { foreignKey: "product_id", as: "mediaAssignments" });
  ProductMediaAssignment.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  MediaAsset.hasMany(ProductMediaAssignment, { foreignKey: "media_asset_id", as: "productMediaAssignments" });
  ProductMediaAssignment.belongsTo(MediaAsset, { foreignKey: "media_asset_id", as: "mediaAsset" });

  MediaAsset.hasMany(ProductContentBlock, { foreignKey: "media_asset_id", as: "productContentBlocks" });
  ProductContentBlock.belongsTo(MediaAsset, { foreignKey: "media_asset_id", as: "media" });

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

  Cart.hasMany(Order, { foreignKey: "cart_id", as: "orders" });
  Order.belongsTo(Cart, { foreignKey: "cart_id", as: "cart" });

  Order.hasMany(OrderItem, { foreignKey: "order_id", as: "items" });
  OrderItem.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  Order.hasMany(OrderDocument, { foreignKey: "order_id", as: "documents" });
  OrderDocument.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  Product.hasMany(OrderItem, { foreignKey: "product_id", as: "orderItems" });
  OrderItem.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  ProductVariant.hasMany(OrderItem, { foreignKey: "product_variant_id", as: "orderItems" });
  OrderItem.belongsTo(ProductVariant, { foreignKey: "product_variant_id", as: "variant" });

  Product.hasMany(ProductReview, { foreignKey: "product_id", as: "reviews" });
  ProductReview.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  User.hasMany(ProductReview, { foreignKey: "user_id", as: "productReviews" });
  ProductReview.belongsTo(User, { foreignKey: "user_id", as: "user" });

  OrderItem.hasOne(ProductReview, { foreignKey: "order_item_id", as: "review" });
  ProductReview.belongsTo(OrderItem, { foreignKey: "order_item_id", as: "orderItem" });

  Order.hasMany(OrderNote, { foreignKey: "order_id", as: "notes" });
  OrderNote.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  User.hasMany(OrderNote, { foreignKey: "admin_id", as: "authoredOrderNotes" });
  OrderNote.belongsTo(User, { foreignKey: "admin_id", as: "author" });

  Order.hasMany(Payment, { foreignKey: "order_id", as: "payments" });
  Payment.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  Order.hasMany(Shipment, { foreignKey: "order_id", as: "shipments" });
  Shipment.belongsTo(Order, { foreignKey: "order_id", as: "order" });
  Replacement.hasOne(Shipment, { foreignKey: "replacement_id", as: "shipment" });
  Shipment.belongsTo(Replacement, { foreignKey: "replacement_id", as: "replacement" });
  Shipment.hasMany(ShipmentTrackingEvent, { foreignKey: "shipment_id", as: "trackingEvents" });
  ShipmentTrackingEvent.belongsTo(Shipment, { foreignKey: "shipment_id", as: "shipment" });

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

  Order.hasMany(Refund, { foreignKey: "order_id", as: "refunds" });
  Refund.belongsTo(Order, { foreignKey: "order_id", as: "order" });

  Payment.hasMany(Refund, { foreignKey: "payment_id", as: "refunds" });
  Refund.belongsTo(Payment, { foreignKey: "payment_id", as: "payment" });

  ReturnRequest.hasMany(Refund, { foreignKey: "return_request_id", as: "refunds" });
  Refund.belongsTo(ReturnRequest, { foreignKey: "return_request_id", as: "returnRequest" });

  User.hasMany(Refund, { foreignKey: "initiated_by_admin_id", as: "initiatedRefunds" });
  Refund.belongsTo(User, { foreignKey: "initiated_by_admin_id", as: "initiatedBy" });

  ReturnRequest.hasOne(ReturnShipment, { foreignKey: "return_request_id", as: "returnShipment" });
  ReturnShipment.belongsTo(ReturnRequest, { foreignKey: "return_request_id", as: "returnRequest" });
  ReturnShipment.hasMany(ReturnShipmentTrackingEvent, { foreignKey: "return_shipment_id", as: "trackingEvents" });
  ReturnShipmentTrackingEvent.belongsTo(ReturnShipment, { foreignKey: "return_shipment_id", as: "returnShipment" });

  ReturnRequest.hasOne(Replacement, { foreignKey: "return_request_id", as: "replacement" });
  Replacement.belongsTo(ReturnRequest, { foreignKey: "return_request_id", as: "returnRequest" });
  Order.hasMany(Replacement, { foreignKey: "order_id", as: "replacements" });
  Replacement.belongsTo(Order, { foreignKey: "order_id", as: "order" });
  OrderItem.hasMany(Replacement, { foreignKey: "order_item_id", as: "replacements" });
  Replacement.belongsTo(OrderItem, { foreignKey: "order_item_id", as: "orderItem" });
  Product.hasMany(Replacement, { foreignKey: "product_id", as: "replacements" });
  Replacement.belongsTo(Product, { foreignKey: "product_id", as: "product" });
  ProductVariant.hasMany(Replacement, { foreignKey: "product_variant_id", as: "replacements" });
  Replacement.belongsTo(ProductVariant, { foreignKey: "product_variant_id", as: "variant" });
  User.hasMany(Replacement, { foreignKey: "approved_by_admin_id", as: "approvedReplacements" });
  Replacement.belongsTo(User, { foreignKey: "approved_by_admin_id", as: "approvedBy" });

  User.hasMany(Wishlist, { foreignKey: "user_id", as: "wishlistItems" });
  Wishlist.belongsTo(User, { foreignKey: "user_id", as: "user" });

  Product.hasMany(Wishlist, { foreignKey: "product_id", as: "wishlistedBy" });
  Wishlist.belongsTo(Product, { foreignKey: "product_id", as: "product" });

  associationsInitialized = true;
}

export function areDatabaseAssociationsInitialized(): boolean {
  return associationsInitialized;
}
