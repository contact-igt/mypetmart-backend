import { Router } from "express";
import { handleStorefrontGetProductBySlug, handleStorefrontListProducts } from "./product.controller.js";

export const storefrontProductRouter = Router();

storefrontProductRouter.get("/", (req, res, next) => {
  void handleStorefrontListProducts(req, res, next);
});

storefrontProductRouter.get("/:slug", (req, res, next) => {
  void handleStorefrontGetProductBySlug(req, res, next);
});
