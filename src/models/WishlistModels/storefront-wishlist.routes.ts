import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { handleAddWishlistItem, handleGetWishlist, handleRemoveWishlistItem } from "./wishlist.controller.js";

export const storefrontWishlistRouter = Router();

storefrontWishlistRouter.use(authenticate("customer"));

storefrontWishlistRouter.get("/", (req, res, next) => {
  void handleGetWishlist(req, res, next);
});

storefrontWishlistRouter.post("/items", (req, res, next) => {
  void handleAddWishlistItem(req, res, next);
});

storefrontWishlistRouter.delete("/items/:productId", (req, res, next) => {
  void handleRemoveWishlistItem(req, res, next);
});
