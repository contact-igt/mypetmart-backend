import { Router } from "express";
import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { AdminContactController } from "./contact.controller.js";

const router = Router();

router.use(authenticate("admin"));

router.get("/", (req, res, next) => {
  void AdminContactController.listEnquiries(req, res, next);
});

router.get("/:enquiryId", (req, res, next) => {
  void AdminContactController.getEnquiryById(req, res, next);
});

router.patch("/:enquiryId", (req, res, next) => {
  void AdminContactController.updateEnquiry(req, res, next);
});

export default router;
