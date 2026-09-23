import { Router } from "express";
import { StorefrontWelcomePopupController } from "./welcome-popup.controller.js";

const router = Router();

router.get("/", (req, res, next) => {
  void StorefrontWelcomePopupController.getActivePopup(req, res, next);
});

export default router;
