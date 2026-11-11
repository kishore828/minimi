/**
 * Idempotent runtime schema initialization.
 *
 * The database creates itself on first use — no migration step, no Docker.
 * This SQL must stay in sync with schema.ts; the drizzle-kit config at the
 * repo root can generate SQL migrations for PostgreSQL ports later.
 */
import type betterSqlite3 from "better-sqlite3";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
  ON conversations (user_id, updated_at);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'complete',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_conversation_created_idx
  ON messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS messages_created_idx
  ON messages (created_at);

CREATE TABLE IF NOT EXISTS conversation_summaries (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  summary TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS summaries_conversation_idx
  ON conversation_summaries (conversation_id);

CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  conversation_id TEXT,
  content TEXT NOT NULL,
  category TEXT NOT NULL,
  importance REAL NOT NULL,
  source_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS memories_user_created_idx
  ON memories (user_id, created_at);
CREATE INDEX IF NOT EXISTS memories_conversation_idx
  ON memories (conversation_id);

CREATE TABLE IF NOT EXISTS research_sessions (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  message_id TEXT,
  query TEXT NOT NULL,
  category TEXT NOT NULL,
  search_count INTEGER NOT NULL DEFAULT 0,
  llm_call_count INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  comparisons_json TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS research_conversation_idx
  ON research_sessions (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS evidence (
  id TEXT PRIMARY KEY,
  research_session_id TEXT NOT NULL,
  citation_index INTEGER NOT NULL,
  claim TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_title TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  source_published_at INTEGER,
  retrieved_at INTEGER NOT NULL,
  excerpt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS evidence_session_idx
  ON evidence (research_session_id, citation_index);

CREATE TABLE IF NOT EXISTS search_cache (
  cache_key TEXT PRIMARY KEY,
  results_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- Full-text search mirrors. Written alongside the parent rows in the same
-- transaction; queried by the hybrid memory retriever.
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(message_id UNINDEXED, content);
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(memory_id UNINDEXED, content);
`;

export function initSchema(sqlite: betterSqlite3.Database): void {
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(SCHEMA_SQL);
}
