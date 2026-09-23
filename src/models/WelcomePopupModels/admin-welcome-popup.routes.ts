import { Router } from "express";
import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { authorize } from "../../middlewares/auth/authorize.middleware.js";
import { AdminWelcomePopupController } from "./welcome-popup.controller.js";

const router = Router();

router.use(authenticate("admin"), authorize("super_admin"));

router.get("/", (req, res, next) => {
  void AdminWelcomePopupController.listItems(req, res, next);
});

router.get("/coupon-options", (req, res, next) => {
  void AdminWelcomePopupController.listCouponOptions(req, res, next);
});

router.post("/", (req, res, next) => {
  void AdminWelcomePopupController.createItem(req, res, next);
});

router.get("/:popupId", (req, res, next) => {
  void AdminWelcomePopupController.getItemById(req, res, next);
});

router.patch("/:popupId", (req, res, next) => {
  void AdminWelcomePopupController.updateItem(req, res, next);
});

router.patch("/:popupId/publish", (req, res, next) => {
  void AdminWelcomePopupController.publishItem(req, res, next);
});

router.patch("/:popupId/activate", (req, res, next) => {
  void AdminWelcomePopupController.activateItem(req, res, next);
});

router.patch("/:popupId/deactivate", (req, res, next) => {
  void AdminWelcomePopupController.deactivateItem(req, res, next);
});

router.patch("/:popupId/archive", (req, res, next) => {
  void AdminWelcomePopupController.archiveItem(req, res, next);
});

router.post("/:popupId/duplicate", (req, res, next) => {
  void AdminWelcomePopupController.duplicateItem(req, res, next);
});

export default router;
