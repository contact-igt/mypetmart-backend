import { Router } from "express";

import { resolveCartIdentity } from "../../middlewares/cart/resolve-cart-identity.middleware.js";
import { handleCheckoutPreview } from "./checkout.controller.js";

export const storefrontCheckoutRouter = Router();

storefrontCheckoutRouter.use(resolveCartIdentity());

storefrontCheckoutRouter.post("/preview", (req, res, next) => {
  void handleCheckoutPreview(req, res, next);
});
