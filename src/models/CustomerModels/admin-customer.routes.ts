import { Router } from "express";
import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { AdminCustomerController } from "./admin-customer.controller.js";

const router = Router();

router.use(authenticate("admin"));

router.get("/", (req, res, next) => {
  void AdminCustomerController.listCustomers(req, res, next);
});

router.get("/:customerId", (req, res, next) => {
  void AdminCustomerController.getCustomerDetail(req, res, next);
});

export default router;
