import { sequelize, disconnectDatabase } from "../database/index.js";

async function dropAllTables() {
  try {
    console.log("Connecting to the database...");
    
    // Disable foreign key checks
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
    
    // Drop all tables
    console.log("Dropping all tables...");
    await sequelize.drop();
    
    // Check for SequelizeMeta and drop it manually if it exists
    const [results] = await sequelize.query("SHOW TABLES LIKE 'SequelizeMeta'");
    if (Array.isArray(results) && results.length > 0) {
       await sequelize.query("DROP TABLE `SequelizeMeta`");
       console.log("Dropped SequelizeMeta table.");
    }
    
    const [seedersResults] = await sequelize.query("SHOW TABLES LIKE 'SequelizeData'");
    if (Array.isArray(seedersResults) && seedersResults.length > 0) {
       await sequelize.query("DROP TABLE `SequelizeData`");
       console.log("Dropped SequelizeData table.");
    }
    
    // Re-enable foreign key checks
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
