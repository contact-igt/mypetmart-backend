import { writeFileSync } from "node:fs";
import { connectDatabase, disconnectDatabase, sequelize } from "../database/index.js";
import { databaseConfig } from "../config/database.config.js";
import { QueryTypes } from "sequelize";

try {
  await connectDatabase();
  
  // Get all tables
  const tables = await sequelize.query<{ TABLE_NAME: string }>(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = :dbName`,
    {
      replacements: { dbName: databaseConfig.database },
      type: QueryTypes.SELECT
    }
  );
  
  const backupData: Record<string, unknown[]> = {};
  let totalUserCount = 0;
  
  for (const t of tables) {
    const tableName = t.TABLE_NAME;
    const rows = await sequelize.query<Record<string, unknown>>(
      `SELECT * FROM \`${tableName}\``,
      { type: QueryTypes.SELECT }
    );
    backupData[tableName] = rows;
    
    if (tableName === "users") {
      totalUserCount = rows.length;
    }
  }
  
  const backupLocation = "D:\\INVICTUS\\mypetmart\\backend\\mypetmart_backup.json";
  writeFileSync(backupLocation, JSON.stringify(backupData, null, 2), "utf8");
  
  console.log("backup created");
  console.log(`backup location: ${backupLocation}`);
  console.log(`database name: ${databaseConfig.database}`);
  console.log(`table count: ${tables.length}`);
  console.log(`user count: ${totalUserCount}`);
  
  await disconnectDatabase();
} catch (error) {
  console.error("Backup failed", error);
  process.exitCode = 1;
}
