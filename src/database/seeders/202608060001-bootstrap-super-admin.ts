import { removeBootstrapSuperAdmin, seedBootstrapSuperAdmin } from "./bootstrap-super-admin.js";
import { requireSeedConfig, type SeederArguments } from "./seeder.types.js";

export async function up({ context }: SeederArguments): Promise<void> {
  await seedBootstrapSuperAdmin(context.sequelize, requireSeedConfig(context));
}

export async function down({ context }: SeederArguments): Promise<void> {
  await removeBootstrapSuperAdmin(context.sequelize, requireSeedConfig(context));
}
