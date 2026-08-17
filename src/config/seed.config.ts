import { z } from "zod";

const STRONG_PASSWORD_MESSAGE = "SEED_SUPER_ADMIN_PASSWORD must be at least 12 characters and include uppercase, lowercase, number, and special character.";

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function requiredTrimmed(name: string) {
  return z.preprocess(
    (value) => (typeof value === "string" ? value.trim() : value),
    z.string({ error: `${name} is required.` }).min(1, `${name} is required.`)
  );
}

function integerFromString(name: string, min: number, max: number) {
  return z.preprocess((value) => {
    if (typeof value === "number") return value;
    if (typeof value !== "string") return value;
    const trimmed = value.trim();
    return trimmed.length > 0 ? Number(trimmed) : undefined;
  }, z.number({ error: `${name} must be a number.` }).int(`${name} must be an integer.`).min(min, `${name} must be at least ${min}.`).max(max, `${name} must be at most ${max}.`));
}

function booleanFromString(name: string) {
  return z.preprocess((value) => {
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") return value;
    const normalized = value.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
    return value;
  }, z.boolean({ error: `${name} must be true or false.` }));
}

const strongPasswordSchema = requiredTrimmed("SEED_SUPER_ADMIN_PASSWORD").superRefine((value, context) => {
  const hasUpper = /[A-Z]/u.test(value);
  const hasLower = /[a-z]/u.test(value);
  const hasNumber = /\d/u.test(value);
  const hasSpecial = /[^A-Za-z0-9]/u.test(value);
  if (value.length < 12 || !hasUpper || !hasLower || !hasNumber || !hasSpecial) {
    context.addIssue({ code: "custom", message: STRONG_PASSWORD_MESSAGE });
  }
});

const seedSchema = z.object({
  SEED_SUPER_ADMIN_NAME: requiredTrimmed("SEED_SUPER_ADMIN_NAME"),
  SEED_SUPER_ADMIN_EMAIL: requiredTrimmed("SEED_SUPER_ADMIN_EMAIL").pipe(z.email("SEED_SUPER_ADMIN_EMAIL must be a valid email address.")).transform((value) => value.toLowerCase()),
  SEED_SUPER_ADMIN_PHONE: z.preprocess(optionalString, z.string().max(32, "SEED_SUPER_ADMIN_PHONE must be at most 32 characters.").optional()),
  SEED_SUPER_ADMIN_PASSWORD: strongPasswordSchema,
  SEED_SUPER_ADMIN_BCRYPT_ROUNDS: integerFromString("SEED_SUPER_ADMIN_BCRYPT_ROUNDS", 10, 14).default(12),
  ALLOW_PRODUCTION_SEED: booleanFromString("ALLOW_PRODUCTION_SEED").default(false)
});

export type SeedConfig = Readonly<z.infer<typeof seedSchema>>;

export class SeedConfigValidationError extends Error {
  public readonly issues: string[];

  public constructor(issues: string[]) {
    super(`Seed configuration validation failed: ${issues.join("; ")}`);
    this.name = "SeedConfigValidationError";
    this.issues = issues;
  }
}

function sanitizeIssue(issue: z.ZodIssue): string {
  const path = issue.path.join(".") || "seed";
  return `${path}: ${issue.message}`;
}

export function parseSeedConfig(environment: NodeJS.ProcessEnv): SeedConfig {
  const parsed = seedSchema.safeParse(environment);
  if (!parsed.success) {
    throw new SeedConfigValidationError(parsed.error.issues.map(sanitizeIssue));
  }
  return Object.freeze(parsed.data);
}

export function loadSeedConfig(): SeedConfig {
  return parseSeedConfig(process.env);
}

export function redactEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@", 2);
  const safeLocal = local.length <= 2 ? "**" : `${local.slice(0, 2)}***`;
  return `${safeLocal}@${domain}`;
}
