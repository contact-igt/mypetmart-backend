import bcrypt from "bcrypt";
import { QueryTypes, type Sequelize, type Transaction } from "sequelize";

import type { SeedConfig } from "../../config/seed.config.js";
import { DATABASE_TABLE_NAMES } from "../../constants/database.constants.js";
import { BOOTSTRAP_SUPER_ADMIN_SEEDER_NAME, SEEDER_METADATA_TABLE_NAME } from "./seeder.constants.js";
import { IdSequenceService } from "../sequences/id-sequence.service.js";
import { buildBusinessReference } from "../../utils/reference-generator.js";

type ExistingUserRow = {
  id: number;
  role: "customer" | "admin" | "super_admin";
  status: "active" | "disabled";
  name: string;
  email: string;
  phone: string | null;
};

type CountRow = { count: number };

export type BootstrapSuperAdminSeedResult = {
  action: "created" | "already_satisfied";
  userId: number;
  email: string;
};

export type BootstrapSuperAdminSafeSnapshot = {
  id: number;
  email: string;
  role: string;
  status: string;
  hasPasswordHash: boolean;
  passwordHashLooksBcrypt: boolean;
  createdAt: Date | string;
};

export type BootstrapSuperAdminConflictCode =
  | "SEED_SUPER_ADMIN_ROLE_CONFLICT"
  | "SEED_SUPER_ADMIN_DISABLED_CONFLICT"
  | "SEED_SUPER_ADMIN_OWNERSHIP_MISMATCH"
  | "SEED_SUPER_ADMIN_ROLLBACK_DEPENDENCY_CONFLICT";

export class BootstrapSuperAdminSeederError extends Error {
  public readonly code: BootstrapSuperAdminConflictCode;

  public constructor(code: BootstrapSuperAdminConflictCode, message: string) {
    super(message);
    this.name = "BootstrapSuperAdminSeederError";
    this.code = code;
  }
}

export function isBcryptHash(value: string): boolean {
  return /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/u.test(value);
}

async function findUserByEmail(sequelize: Sequelize, email: string, transaction: Transaction): Promise<ExistingUserRow | undefined> {
  const [row] = await sequelize.query<ExistingUserRow>(
    `SELECT id, role, status, name, email, phone FROM ${DATABASE_TABLE_NAMES.users} WHERE email = :email LIMIT 1`,
    { replacements: { email }, type: QueryTypes.SELECT, transaction }
  );
  return row;
}

function assertExistingUserIsSafeForSuperAdmin(existingUser: ExistingUserRow | undefined): ExistingUserRow | undefined {
  if (existingUser === undefined) return undefined;

  if (existingUser.role === "customer") {
    throw new BootstrapSuperAdminSeederError(
      "SEED_SUPER_ADMIN_ROLE_CONFLICT",
      "Configured bootstrap super-admin email belongs to a customer account."
    );
  }

  if (existingUser.role === "admin") {
    throw new BootstrapSuperAdminSeederError(
      "SEED_SUPER_ADMIN_ROLE_CONFLICT",
      "Configured bootstrap super-admin email belongs to a normal admin account."
    );
  }

  // role === "super_admin"
  if (existingUser.status === "disabled") {
    throw new BootstrapSuperAdminSeederError(
      "SEED_SUPER_ADMIN_DISABLED_CONFLICT",
      "Configured bootstrap super-admin is disabled. Manual review required."
    );
  }

  return existingUser;
}

export async function seedBootstrapSuperAdmin(sequelize: Sequelize, seedConfig: SeedConfig): Promise<BootstrapSuperAdminSeedResult> {
  return sequelize.transaction(async (transaction) => {
    const existingUser = await findUserByEmail(sequelize, seedConfig.SEED_SUPER_ADMIN_EMAIL, transaction);
    const matchingUser = assertExistingUserIsSafeForSuperAdmin(existingUser);

    if (matchingUser !== undefined) {
      // Active super_admin already exists with matching email — bootstrap already satisfied.
      return { action: "already_satisfied", userId: matchingUser.id, email: matchingUser.email };
    }

    const passwordHash = await bcrypt.hash(seedConfig.SEED_SUPER_ADMIN_PASSWORD, seedConfig.SEED_SUPER_ADMIN_BCRYPT_ROUNDS);

    // Allocate next sequential ID from the id_sequences table
    const allocatedId = await IdSequenceService.allocateNextId("users", transaction);
    const refCode = buildBusinessReference("super_admin", allocatedId);

    await sequelize.query(
      `INSERT INTO ${DATABASE_TABLE_NAMES.users} (id, role, status, name, email, phone, password_hash, email_verified_at, last_login_at, reference_code) VALUES (:id, 'super_admin', 'active', :name, :email, :phone, :passwordHash, NULL, NULL, :refCode)`,
      {
        replacements: {
          id: allocatedId,
          name: seedConfig.SEED_SUPER_ADMIN_NAME,
          email: seedConfig.SEED_SUPER_ADMIN_EMAIL,
          phone: seedConfig.SEED_SUPER_ADMIN_PHONE ?? null,
          passwordHash,
          refCode
        },
        transaction
      }
    );

    return { action: "created", userId: allocatedId, email: seedConfig.SEED_SUPER_ADMIN_EMAIL };
  });
}

async function executedSeederMetadataExists(sequelize: Sequelize, transaction: Transaction): Promise<boolean> {
  const [row] = await sequelize.query<CountRow>(`SELECT COUNT(*) AS count FROM ${SEEDER_METADATA_TABLE_NAME} WHERE name = :name`, {
    replacements: { name: `${BOOTSTRAP_SUPER_ADMIN_SEEDER_NAME}.ts` },
    type: QueryTypes.SELECT,
    transaction
  });
  return (row?.count ?? 0) > 0;
}

export async function removeBootstrapSuperAdmin(sequelize: Sequelize, seedConfig: SeedConfig): Promise<{ removed: boolean; email: string }> {
  return sequelize.transaction(async (transaction) => {
    const hasMetadata = await executedSeederMetadataExists(sequelize, transaction);
    if (!hasMetadata) {
      throw new BootstrapSuperAdminSeederError("SEED_SUPER_ADMIN_OWNERSHIP_MISMATCH", "Bootstrap super-admin seeder metadata is not executed.");
    }

    const existingUser = await findUserByEmail(sequelize, seedConfig.SEED_SUPER_ADMIN_EMAIL, transaction);
    if (existingUser === undefined) {
      return { removed: false, email: seedConfig.SEED_SUPER_ADMIN_EMAIL };
    }

    // Ownership validation: must be a super_admin account.
    if (existingUser.role !== "super_admin") {
      throw new BootstrapSuperAdminSeederError(
        "SEED_SUPER_ADMIN_OWNERSHIP_MISMATCH",
        "The account with the configured email is not a super_admin. Rollback refused to prevent data loss."
      );
    }

    // Check for dependent audit records using the user's actual ID.
    const userId = existingUser.id;
    const [orderNotes] = await sequelize.query<CountRow>(`SELECT COUNT(*) AS count FROM ${DATABASE_TABLE_NAMES.orderNotes} WHERE admin_id = :userId`, {
      replacements: { userId },
      type: QueryTypes.SELECT,
      transaction
    });
    const [returnNotes] = await sequelize.query<CountRow>(`SELECT COUNT(*) AS count FROM ${DATABASE_TABLE_NAMES.returnNotes} WHERE admin_id = :userId`, {
      replacements: { userId },
      type: QueryTypes.SELECT,
      transaction
    });
    if ((orderNotes?.count ?? 0) > 0 || (returnNotes?.count ?? 0) > 0) {
      throw new BootstrapSuperAdminSeederError(
        "SEED_SUPER_ADMIN_ROLLBACK_DEPENDENCY_CONFLICT",
        "Bootstrap super-admin has dependent audit records and requires manual rollback review."
      );
    }

    await sequelize.query(
      `DELETE FROM ${DATABASE_TABLE_NAMES.users} WHERE id = :userId AND email = :email AND role = 'super_admin'`,
      { replacements: { userId, email: seedConfig.SEED_SUPER_ADMIN_EMAIL }, transaction }
    );
    return { removed: true, email: seedConfig.SEED_SUPER_ADMIN_EMAIL };
  });
}

export async function getBootstrapSuperAdminSafeSnapshot(sequelize: Sequelize, seedConfig: SeedConfig): Promise<BootstrapSuperAdminSafeSnapshot | undefined> {
  const [row] = await sequelize.query<BootstrapSuperAdminSafeSnapshot & { passwordHash: string }>(
    `SELECT id, email, role, status, password_hash AS passwordHash, created_at AS createdAt FROM ${DATABASE_TABLE_NAMES.users} WHERE email = :email AND role = 'super_admin' LIMIT 1`,
    { replacements: { email: seedConfig.SEED_SUPER_ADMIN_EMAIL }, type: QueryTypes.SELECT }
  );
  if (row === undefined) return undefined;
  return {
    id: row.id,
    email: row.email,
    role: row.role,
    status: row.status,
    hasPasswordHash: row.passwordHash.length > 0,
    passwordHashLooksBcrypt: isBcryptHash(row.passwordHash),
    createdAt: row.createdAt
  };
}
