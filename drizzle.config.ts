import { defineConfig } from "drizzle-kit";

/**
 * Schema management for development. At runtime the app initializes the
 * SQLite schema itself (src/server/database/init.ts), so this config exists
 * for `drizzle-kit generate` / `drizzle-kit studio` workflows and for
 * generating SQL when porting to PostgreSQL.
 */
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/server/database/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ? process.env.DATABASE_URL.replace(/^file:/, "") : "data/memento.db",
  },
});
