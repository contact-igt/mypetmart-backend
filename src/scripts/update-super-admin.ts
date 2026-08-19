import bcrypt from "bcrypt";
import { QueryTypes } from "sequelize";

import { sequelize, disconnectDatabase } from "../database/index.js";
import { loadSeedConfig } from "../config/seed.config.js";
import { DATABASE_TABLE_NAMES } from "../constants/database.constants.js";

type SuperAdminRow = { id: number; email: string };

async function updateSuperAdmin() {
  try {
    if ((process.env.NODE_ENV ?? "development") === "production" && process.env.CONFIRM_SUPER_ADMIN_UPDATE !== "true") {
      throw new Error("Refusing to update super admin in production unless CONFIRM_SUPER_ADMIN_UPDATE=true is set.");
    }

    console.log("Connecting to the database...");
    await sequelize.authenticate();

    console.log("Loading new credentials from .env (SEED_SUPER_ADMIN_*)...");
    const seedConfig = loadSeedConfig();

    const targetEmail = process.env.SUPER_ADMIN_CURRENT_EMAIL?.trim().toLowerCase();

    await sequelize.transaction(async (transaction) => {
      const rows = await sequelize.query<SuperAdminRow>(
        targetEmail
          ? `SELECT id, email FROM ${DATABASE_TABLE_NAMES.users} WHERE role = 'super_admin' AND email = :targetEmail`
          : `SELECT id, email FROM ${DATABASE_TABLE_NAMES.users} WHERE role = 'super_admin'`,
        { replacements: { targetEmail }, type: QueryTypes.SELECT, transaction }
      );

      if (rows.length === 0) {
        throw new Error(targetEmail ? `No super_admin found with email ${targetEmail}.` : "No super_admin account exists to update.");
      }
      if (rows.length > 1) {
        throw new Error(
          `Multiple super_admin accounts found (${rows.map((row) => row.email).join(", ")}). Set SUPER_ADMIN_CURRENT_EMAIL to target one.`
        );
      }

      const [existing] = rows;
      if (existing === undefined) {
        throw new Error("Unexpected empty super_admin lookup result.");
      }
      const passwordHash = await bcrypt.hash(seedConfig.SEED_SUPER_ADMIN_PASSWORD, seedConfig.SEED_SUPER_ADMIN_BCRYPT_ROUNDS);

      await sequelize.query(
        `UPDATE ${DATABASE_TABLE_NAMES.users}
         SET name = :newName, email = :newEmail, phone = :newPhone, password_hash = :newPasswordHash
         WHERE id = :id AND role = 'super_admin'`,
        {
          replacements: {
            id: existing.id,
            newName: seedConfig.SEED_SUPER_ADMIN_NAME,
            newEmail: seedConfig.SEED_SUPER_ADMIN_EMAIL,
            newPhone: seedConfig.SEED_SUPER_ADMIN_PHONE ?? null,
            newPasswordHash: passwordHash
          },
          transaction
        }
      );

      console.log(`Updated super_admin id=${existing.id}: ${existing.email} -> ${seedConfig.SEED_SUPER_ADMIN_EMAIL}`);
    });

    console.log("Super admin credentials updated successfully.");
  } catch (error) {
    console.error("Error updating super admin:", error);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void updateSuperAdmin();
