import { z } from "zod";

export const SignupSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Name is required.")
      .max(160, "Name must be at most 160 characters."),
    email: z
      .string()
      .trim()
      .min(1, "Email is required.")
      .email("Invalid email format.")
      .max(190, "Email must be at most 190 characters."),
    phone: z
      .string()
      .trim()
      .regex(/^[\d\s+\-()]*$/, "Invalid phone format.")
      .max(32, "Phone must be at most 32 characters.")
      .optional()
      .nullable()
      .or(z.literal("")),
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(72, "Password must be at most 72 characters."),
    passwordConfirmation: z.string().min(1, "Password confirmation is required.")
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "Passwords do not match.",
    path: ["passwordConfirmation"]
  });

export const SigninSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Invalid email format."),
  password: z.string().min(1, "Password is required.")
});

export const VerifyEmailSchema = z.object({
  challengeId: z.number().int().positive("Invalid challenge ID."),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "OTP must be exactly 6 numeric digits.")
});

export const ResendVerificationSchema = z.object({
  challengeId: z.number().int().positive("Invalid challenge ID.").optional(),
  email: z.string().trim().email("Invalid email format.").optional()
});

export const ForgotPasswordSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, "Email is required.")
    .email("Invalid email format.")
});

export const VerifyResetOTPSchema = z.object({
  challengeId: z.number().int().positive("Invalid challenge ID.").optional(),
  otp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, "OTP must be exactly 6 numeric digits.")
});

export const ResetPasswordSchema = z
  .object({
    password: z
      .string()
      .min(8, "Password must be at least 8 characters.")
      .max(72, "Password must be at most 72 characters."),
    passwordConfirmation: z.string().min(1, "Password confirmation is required.")
  })
  .refine((data) => data.password === data.passwordConfirmation, {
    message: "Passwords do not match.",
    path: ["passwordConfirmation"]
  });
