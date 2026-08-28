import { Router } from "express";

import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import {
  handleAdminCreateFaq,
  handleAdminDeleteFaq,
  handleAdminReorderFaqs,
  handleAdminUpdateFaq
} from "./product-faq.controller.js";

export const adminFaqRouter = Router();

adminFaqRouter.use(authenticate("admin"));

adminFaqRouter.post("/:productId/faqs", (req, res, next) => {
  void handleAdminCreateFaq(req, res, next);
});

adminFaqRouter.patch("/:productId/faqs/reorder", (req, res, next) => {
  void handleAdminReorderFaqs(req, res, next);
});

adminFaqRouter.patch("/:productId/faqs/:faqId", (req, res, next) => {
  void handleAdminUpdateFaq(req, res, next);
});

adminFaqRouter.delete("/:productId/faqs/:faqId", (req, res, next) => {
  void handleAdminDeleteFaq(req, res, next);
});
