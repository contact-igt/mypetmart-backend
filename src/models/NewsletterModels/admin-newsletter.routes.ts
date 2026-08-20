import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { AdminNewsletterController } from "./admin-newsletter.controller.js";

export const adminNewsletterRouter = Router();

adminNewsletterRouter.use(authenticate("admin"));

adminNewsletterRouter.get("/subscribers", (req, res, next) => {
  void AdminNewsletterController.listSubscribers(req, res, next);
});
