import { describe, expect, it } from "vitest";

import { databaseConfig, getSequelizeOptions } from "./database.config.js";

describe("database configuration", () => {
  it("maps typed environment values into Sequelize options", () => {
    const options = getSequelizeOptions();

    expect(databaseConfig.dialect).toBe("mysql");
    expect(databaseConfig.database).toBe("mypetmart");
    expect(options.dialect).toBe("mysql");
    expect(options.host).toBe(databaseConfig.host);
    expect(options.port).toBe(databaseConfig.port);
    expect(options.pool).toEqual(databaseConfig.pool);
  });

  it("does not expose the password through Sequelize options", () => {
    const options = getSequelizeOptions();

    expect(Object.keys(options)).not.toContain("password");
  });
});
