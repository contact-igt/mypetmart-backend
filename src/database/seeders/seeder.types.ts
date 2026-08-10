import type { QueryInterface, Sequelize } from "sequelize";

import type { SeedConfig } from "../../config/seed.config.js";

export type SeederContext = {
  queryInterface: QueryInterface;
  sequelize: Sequelize;
  seedConfig?: SeedConfig;
};

export type SeederArguments = {
  context: SeederContext;
};

export function requireSeedConfig(context: SeederContext): SeedConfig {
  if (context.seedConfig === undefined) {
    throw new Error("Seed configuration is required for this seeder operation.");
  }
  return context.seedConfig;
}
