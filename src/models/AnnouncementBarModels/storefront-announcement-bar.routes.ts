import { Router } from "express";
import { StorefrontAnnouncementBarController } from "./announcement-bar.controller.js";

const router = Router();

router.get("/", (req, res, next) => {
  void StorefrontAnnouncementBarController.listItems(req, res, next);
});

export default router;
