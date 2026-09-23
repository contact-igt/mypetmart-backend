import { Router } from "express";
import { authenticate } from "../../middlewares/auth/authenticate.middleware.js";
import { authorize } from "../../middlewares/auth/authorize.middleware.js";
import { AdminCouponController } from "./admin-coupon.controller.js";

export const adminCouponRouter = Router();
adminCouponRouter.use(authenticate("admin"), authorize("super_admin"));
adminCouponRouter.get("/", (req, res, next) => { void AdminCouponController.list(req, res, next); });
adminCouponRouter.post("/", (req, res, next) => { void AdminCouponController.create(req, res, next); });
adminCouponRouter.get("/:couponId", (req, res, next) => { void AdminCouponController.get(req, res, next); });
adminCouponRouter.patch("/:couponId", (req, res, next) => { void AdminCouponController.update(req, res, next); });
adminCouponRouter.patch("/:couponId/status", (req, res, next) => { void AdminCouponController.setStatus(req, res, next); });
adminCouponRouter.get("/:couponId/redemptions", (req, res, next) => { void AdminCouponController.redemptions(req, res, next); });
