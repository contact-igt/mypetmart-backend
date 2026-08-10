import { defineConfig } from "vitest/config";

process.env.NODE_ENV = "test";
process.env.DB_NAME = "mypetmart_test";

export default defineConfig({
  test: {
    globalSetup: "./tests/global-setup.ts",
    pool: "threads",
    fileParallelism: false,
    sequence: {
      concurrent: false
    }
  }
});
