import { sequelize, disconnectDatabase } from "../database/index.js";

async function truncateTable() {
  const tableName = process.argv[2];
  
  if (!tableName) {
    console.error("Please provide a table name. Example: npm run db:truncate:table users");
    process.exitCode = 1;
    return;
  }

  try {
    console.log("Connecting to the database...");
    
    // Check if table exists
    const [results] = await sequelize.query(`SHOW TABLES LIKE '${tableName}'`);
    if (!Array.isArray(results) || results.length === 0) {
      console.error(`Table '${tableName}' does not exist in the database.`);
      process.exitCode = 1;
      return;
    }
    
    // Disable foreign key checks
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 0");
    
    console.log(`Truncating table: ${tableName}`);
    await sequelize.query(`TRUNCATE TABLE \`${tableName}\``);
    
    // Re-enable foreign key checks
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1");
    
    console.log(`Table '${tableName}' data has been successfully truncated.`);
  } catch (error) {
    console.error(`Error truncating table ${tableName}:`, error);
    await sequelize.query("SET FOREIGN_KEY_CHECKS = 1").catch(() => {});
    process.exitCode = 1;
  } finally {
    await disconnectDatabase();
  }
}

void truncateTable();
