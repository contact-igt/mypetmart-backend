import type { NextFunction, Request, Response } from "express";
import type { ZodError } from "zod";
import { ValidationError } from "../AuthModels/auth.errors.js";
import { sendSuccess } from "../../utils/api-response.js";
import { AdminCouponService } from "./admin-coupon.service.js";
import { AdminCouponInputSchema, AdminCouponListSchema, AdminCouponRedemptionListSchema, AdminCouponStatusSchema, parseCouponId } from "./admin-coupon.validation.js";

function validation(error: ZodError): ValidationError {
  const errors: Record<string, string[]> = {};
  for (const issue of error.issues) (errors[issue.path.join(".") || "body"] ??= []).push(issue.message);
  return new ValidationError(errors);
}

function parse<T>(result: { success: true; data: T } | { success: false; error: ZodError }): T {
  if (!result.success) throw validation(result.error);
  return result.data;
}

export class AdminCouponController {
  public static async list(req: Request, res: Response, next: NextFunction) { try { sendSuccess(res, 200, await AdminCouponService.list(parse(AdminCouponListSchema.safeParse(req.query)))); } catch (error) { next(error); } }
  public static async get(req: Request, res: Response, next: NextFunction) { try { sendSuccess(res, 200, await AdminCouponService.get(parseCouponId(req.params.couponId))); } catch (error) { next(error); } }
  public static async create(req: Request, res: Response, next: NextFunction) { try { sendSuccess(res, 201, await AdminCouponService.create(parse(AdminCouponInputSchema.safeParse(req.body)))); } catch (error) { next(error); } }
  public static async update(req: Request, res: Response, next: NextFunction) { try { sendSuccess(res, 200, await AdminCouponService.update(parseCouponId(req.params.couponId), parse(AdminCouponInputSchema.safeParse(req.body)))); } catch (error) { next(error); } }
  public static async setStatus(req: Request, res: Response, next: NextFunction) { try { const input = parse(AdminCouponStatusSchema.safeParse(req.body)); sendSuccess(res, 200, await AdminCouponService.setStatus(parseCouponId(req.params.couponId), input.status)); } catch (error) { next(error); } }
  public static async redemptions(req: Request, res: Response, next: NextFunction) { try { sendSuccess(res, 200, await AdminCouponService.listRedemptions(parseCouponId(req.params.couponId), parse(AdminCouponRedemptionListSchema.safeParse(req.query)))); } catch (error) { next(error); } }
}
