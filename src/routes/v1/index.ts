import { Router } from "express";

import { healthRouter } from "../../models/HealthModels/health.routes.js";
import authRouter from "../../models/AuthModels/auth.routes.js";
import adminAuthRouter from "../../models/AuthModels/admin-auth.routes.js";
import adminCustomerRouter from "../../models/CustomerModels/admin-customer.routes.js";
import storefrontCategoryRouter from "../../models/CategoryModels/storefront-category.routes.js";
import adminCategoryRouter from "../../models/CategoryModels/admin-category.routes.js";
import { storefrontProductRouter } from "../../models/ProductModels/storefront-product.routes.js";
import { adminProductRouter } from "../../models/ProductModels/admin-product.routes.js";
import { adminVariantRouter } from "../../models/ProductModels/admin-variant.routes.js";
import { adminImageRouter } from "../../models/ProductModels/admin-image.routes.js";
import { storefrontCartRouter } from "../../models/CartModels/storefront-cart.routes.js";
import { storefrontAddressRouter } from "../../models/AddressModels/storefront-address.routes.js";
import { storefrontCheckoutRouter } from "../../models/CheckoutModels/storefront-checkout.routes.js";
import { storefrontOrderRouter } from "../../models/OrderModels/storefront-order.routes.js";
import { adminOrderRouter } from "../../models/OrderModels/admin-order.routes.js";
import { storefrontWishlistRouter } from "../../models/WishlistModels/storefront-wishlist.routes.js";
import { storefrontPaymentRouter } from "../../models/PaymentModels/storefront-payment.routes.js";
import { payuWebhookRouter } from "../../models/PaymentModels/payu-webhook.routes.js";
import { storefrontReturnRouter } from "../../models/ReturnModels/storefront-return.routes.js";
import { adminReturnRouter } from "../../models/ReturnModels/admin-return.routes.js";
import { adminRefundRouter } from "../../models/RefundModels/admin-refund.routes.js";
import { payuRefundWebhookRouter } from "../../models/RefundModels/payu-refund-webhook.routes.js";

export const v1Router = Router();

v1Router.use(healthRouter);
v1Router.use("/auth", authRouter);
v1Router.use("/admin/auth", adminAuthRouter);
v1Router.use("/admin/customers", adminCustomerRouter);
v1Router.use("/storefront/categories", storefrontCategoryRouter);
v1Router.use("/admin/categories", adminCategoryRouter);
v1Router.use("/storefront/products", storefrontProductRouter);
v1Router.use("/admin/products", adminProductRouter);
v1Router.use("/admin/products", adminVariantRouter);
v1Router.use("/admin/products", adminImageRouter);
v1Router.use("/storefront/cart", storefrontCartRouter);
v1Router.use("/storefront/addresses", storefrontAddressRouter);
v1Router.use("/storefront/checkout", storefrontCheckoutRouter);
v1Router.use("/storefront/orders", storefrontOrderRouter);
v1Router.use("/admin/orders", adminOrderRouter);
v1Router.use("/storefront/wishlist", storefrontWishlistRouter);
v1Router.use("/storefront/payments", storefrontPaymentRouter);
v1Router.use("/payments/payu", payuWebhookRouter);
v1Router.use("/storefront/returns", storefrontReturnRouter);
v1Router.use("/admin/returns", adminReturnRouter);
v1Router.use("/admin", adminRefundRouter);
v1Router.use("/payments/payu", payuRefundWebhookRouter);


