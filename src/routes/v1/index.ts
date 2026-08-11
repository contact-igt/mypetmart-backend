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


