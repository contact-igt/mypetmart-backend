
import { sequelize, disconnectDatabase } from "../database/index.js";
import { loadSeedConfig } from "../config/seed.config.js";
import { seedBootstrapSuperAdmin } from "../database/seeders/bootstrap-super-admin.js";

async function addSuperAdmin() {
  try {
    console.log("Connecting to the database...");
    await sequelize.authenticate();
    
    console.log("Loading seed configuration from .env...");
    const seedConfig = loadSeedConfig();
    
    console.log("Seeding super admin...");
    const result = await seedBootstrapSuperAdmin(sequelize, seedConfig);
    
    console.log(`Action: ${result.action}`);
    console.log(`Super Admin User ID: ${result.userId}`);
    console.log(`Super Admin Email: ${result.email}`);
    
    console.log("Super admin successfully added/verified!");
  } catch (error) {
    console.error("Error adding super admin:", error);
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void addSuperAdmin();
