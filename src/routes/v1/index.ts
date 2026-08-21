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
import { adminMediaRouter } from "../../models/MediaModels/admin-media.routes.js";
import { adminDashboardRouter } from "../../models/DashboardModels/admin-dashboard.routes.js";
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
import { adminShipmentRouter } from "../../models/ShipmentModels/admin-shipment.routes.js";
import { storefrontNewsletterRouter } from "../../models/NewsletterModels/storefront-newsletter.routes.js";
import { adminNewsletterRouter } from "../../models/NewsletterModels/admin-newsletter.routes.js";
import { adminSettingsRouter } from "../../models/SettingsModels/admin-settings.routes.js";

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
v1Router.use("/admin/media", adminMediaRouter);
v1Router.use("/admin/dashboard", adminDashboardRouter);
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
v1Router.use("/storefront/newsletter", storefrontNewsletterRouter);
// Registered ahead of adminRefundRouter (mounted broadly at "/admin", gated to
// super_admin) so /admin/newsletter/* is matched here first instead of falling
// through into that router's super_admin-only gate.
v1Router.use("/admin/newsletter", adminNewsletterRouter);
// Same reasoning as /admin/newsletter above — registered ahead of the broad
// adminRefundRouter mount so /admin/settings/* is matched here first.
v1Router.use("/admin/settings", adminSettingsRouter);
v1Router.use("/admin", adminRefundRouter);
v1Router.use("/admin/shipments", adminShipmentRouter);
v1Router.use("/payments/payu", payuRefundWebhookRouter);


