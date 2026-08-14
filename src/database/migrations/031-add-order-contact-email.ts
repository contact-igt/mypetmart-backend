import { DataTypes } from "sequelize";
import type { MigrationArguments } from "./migration-helpers.js";

export async function up({ context }: MigrationArguments): Promise<void> {
  await context.queryInterface.addColumn("orders", "contact_email", {
    type: DataTypes.STRING(255),
    allowNull: true,
  });
}

export async function down({ context }: MigrationArguments): Promise<void> {
  await context.queryInterface.removeColumn("orders", "contact_email");
}
