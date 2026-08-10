import type { Request, Response, NextFunction } from "express";
import { ForbiddenError } from "../../models/AuthModels/auth.errors.js";
import type { UserRole } from "../../constants/database.constants.js";

export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const user = req.user;
      if (!user) {
        throw new ForbiddenError();
      }

      let hasRole = allowedRoles.includes(user.role);
      // A super_admin may access routes that allow admin
      if (user.role === "super_admin" && allowedRoles.includes("admin")) {
        hasRole = true;
      }

      if (!hasRole) {
        throw new ForbiddenError();
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
