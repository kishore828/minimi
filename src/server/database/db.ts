/**
 * Database connection management.
 *
 * - `openDatabase(path)` creates/opens a SQLite file, initializes the schema
 *   and returns `{ sqlite, db }` (raw driver + Drizzle instance).
 * - `getDatabase()` is the process-wide singleton used by API routes.
 * - Tests open their own isolated databases (often `:memory:`) and inject
 *   them into repositories — no global state leaks between tests.
 */
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";
import { initSchema } from "./init";
import { getConfig } from "../config";

export type SqliteDb = BetterSQLite3Database<typeof schema>;

export interface DatabaseHandle {
  sqlite: Database.Database;
  db: SqliteDb;
}

/** Normalize DATABASE_URL ("file:./x.db", "./x.db", ":memory:" ...). */
export function resolveDatabasePath(databaseUrl: string): string {
  let p = databaseUrl.trim();
  if (p.startsWith("file:")) p = p.slice(5);
  p = p.replace(/^sqlite:(\/\/)?/, "");
  return p;
}

export function openDatabase(databaseUrl: string): DatabaseHandle {
  const filePath = resolveDatabasePath(databaseUrl);
  if (filePath !== ":memory:") {
    fs.mkdirSync(path.dirname(path.resolve(filePath)), { recursive: true });
  }
  const sqlite = new Database(filePath);
  initSchema(sqlite);
  const db = drizzle(sqlite, { schema });
  return { sqlite, db };
}

let handle: DatabaseHandle | null = null;

export function getDatabase(): DatabaseHandle {
  if (!handle) {
    handle = openDatabase(getConfig().databaseUrl);
  }
  return handle;
}

/** Used by tests to verify persistence across "restarts". */
export function closeDatabase(): void {
  if (handle) {
    handle.sqlite.close();
    handle = null;
  }
}
