import { sequelize, disconnectDatabase } from "../database/index.js";

async function truncateAllData() {
  try {
    console.log("Connecting to the database...");
    
    // Disable foreign key checks
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
    
    // Get all models
    const models = sequelize.models;
    const tableNames = Object.values(models).map(model => model.tableName);
    
    if (tableNames.length === 0) {
      console.log("No tables found to truncate.");
      return;
    }
    
    console.log(`Found ${tableNames.length} tables. Truncating data...`);
    
    for (const tableName of tableNames) {
      console.log(`Truncating table: ${tableName}`);
      await sequelize.query(`TRUNCATE TABLE \`${tableName}\``);
    }
    
    // Re-enable foreign key checks
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
    
    console.log("All table data has been successfully truncated.");
  } catch (error) {
    console.error("Error truncating data:", error);
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void truncateAllData();
