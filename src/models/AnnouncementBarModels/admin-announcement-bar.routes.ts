import { Router } from "express";
import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { authorize } from "../../middlewares/auth/authorize.middleware.js";
import { AdminAnnouncementBarController } from "./announcement-bar.controller.js";

const router = Router();

router.use(authenticate("admin"), authorize("super_admin"));

router.get("/", (req, res, next) => {
  void AdminAnnouncementBarController.listItems(req, res, next);
});

router.post("/", (req, res, next) => {
  void AdminAnnouncementBarController.createItem(req, res, next);
});

router.patch("/reorder", (req, res, next) => {
  void AdminAnnouncementBarController.reorderItems(req, res, next);
});

router.get("/:itemId", (req, res, next) => {
  void AdminAnnouncementBarController.getItemById(req, res, next);
});

router.patch("/:itemId", (req, res, next) => {
  void AdminAnnouncementBarController.updateItem(req, res, next);
});

router.delete("/:itemId", (req, res, next) => {
  void AdminAnnouncementBarController.deleteItem(req, res, next);
});

export default router;
