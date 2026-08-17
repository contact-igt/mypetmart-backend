import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { resolveCartIdentity } from "../../middlewares/cart/resolve-cart-identity.middleware.js";
import {
  handleAddCartItem,
  handleClearCart,
  handleGetCart,
  handleMergeCart,
  handleRemoveCartItem,
  handleUpdateCartItem
} from "./cart.controller.js";

export const storefrontCartRouter = Router();

// Registered before resolveCartIdentity(): merge requires an authenticated customer,
// not the optional guest-or-customer identity the routes below accept.
storefrontCartRouter.post("/merge", authenticate("customer"), (req, res, next) => {
  void handleMergeCart(req, res, next);
});

storefrontCartRouter.use(resolveCartIdentity());

storefrontCartRouter.get("/", (req, res, next) => {
  void handleGetCart(req, res, next);
});

storefrontCartRouter.post("/items", (req, res, next) => {
  void handleAddCartItem(req, res, next);
});

storefrontCartRouter.patch("/items/:cartItemId", (req, res, next) => {
  void handleUpdateCartItem(req, res, next);
});

storefrontCartRouter.delete("/items/:cartItemId", (req, res, next) => {
  void handleRemoveCartItem(req, res, next);
});

storefrontCartRouter.delete("/items", (req, res, next) => {
  void handleClearCart(req, res, next);
});
