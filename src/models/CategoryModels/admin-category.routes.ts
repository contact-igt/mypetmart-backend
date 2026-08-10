import { Router } from "express";
import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { AdminCategoryController } from "./category.controller.js";

const router = Router();

router.use(authenticate("admin"));

router.get("/", (req, res, next) => {
  void AdminCategoryController.listCategories(req, res, next);
});

router.post("/", (req, res, next) => {
  void AdminCategoryController.createCategory(req, res, next);
});

router.patch("/reorder", (req, res, next) => {
  void AdminCategoryController.reorderCategories(req, res, next);
});

router.get("/:categoryId", (req, res, next) => {
  void AdminCategoryController.getCategoryById(req, res, next);
});

router.patch("/:categoryId", (req, res, next) => {
  void AdminCategoryController.updateCategory(req, res, next);
});

router.patch("/:categoryId/status", (req, res, next) => {
  void AdminCategoryController.updateCategoryStatus(req, res, next);
});

router.delete("/:categoryId", (req, res, next) => {
  void AdminCategoryController.deleteCategory(req, res, next);
});

export default router;
