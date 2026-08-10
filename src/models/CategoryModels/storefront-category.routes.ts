import { Router } from "express";
import { StorefrontCategoryController } from "./category.controller.js";

const router = Router();

router.get("/", (req, res, next) => {
  void StorefrontCategoryController.listCategories(req, res, next);
});

router.get("/:slug", (req, res, next) => {
  void StorefrontCategoryController.getCategoryBySlug(req, res, next);
});

export default router;
