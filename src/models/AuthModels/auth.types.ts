import type { z } from "zod";
import type { User } from "../../database/tables/index.js";
import type { SignupSchema, SigninSchema } from "./auth.validation.js";

export type SignupPayload = z.infer<typeof SignupSchema>;
export type SigninPayload = z.infer<typeof SigninSchema>;

export interface SafeUser {
  id: number;
  referenceCode: string;
  name: string;
  email: string;
  phone: string | null;
  role: string;
  status: string;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export function toSafeUserJSON(user: User): SafeUser {
  return {
    id: user.id,
    referenceCode: user.reference_code,
    name: user.name,
    email: user.email,
    phone: user.phone,
    role: user.role,
    status: user.status,
    emailVerifiedAt: user.email_verified_at ? new Date(user.email_verified_at) : null,
    lastLoginAt: user.last_login_at ? new Date(user.last_login_at) : null,
    createdAt: new Date(user.created_at)
  };
}
