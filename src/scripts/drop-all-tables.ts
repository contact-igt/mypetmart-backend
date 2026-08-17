import { sequelize, disconnectDatabase } from "../database/index.js";

async function dropAllTables() {
  try {
    console.log("Connecting to the database...");

    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");

    const queryInterface = sequelize.getQueryInterface();
    const tables = await queryInterface.showAllTables();

    if (tables.length === 0) {
      console.log("No tables found to drop.");
    } else {
      console.log(`Found ${tables.length} tables. Dropping all tables...`);
      await queryInterface.dropAllTables();
    }

    const remainingTables = await queryInterface.showAllTables();
    if (remainingTables.length > 0) {
      throw new Error(`Database cleanup incomplete. Tables still present: ${remainingTables.join(", ")}`);
    }

    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");

    console.log("All tables have been successfully dropped.");
  } catch (error) {
    console.error("Error dropping tables:", error);
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void dropAllTables();
