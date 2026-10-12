/**
 * SQLite persistence using Node's built-in `node:sqlite` (no native modules to compile).
 */

import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DB_PATH = process.env.SKILLBRIDGE_DB ?? resolve(ROOT, 'data', 'skillbridge.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL COLLATE NOCASE,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('learner', 'instructor')),
  is_demo INTEGER NOT NULL DEFAULT 0,
  is_simulated INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS classes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL COLLATE NOCASE,
  instructor_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS class_members (
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (class_id, user_id)
);
CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  class_id TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  template_id TEXT,
  difficulty INTEGER,
  focus_skills TEXT NOT NULL DEFAULT '[]',
  due_at INTEGER,
  note TEXT,
  target_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS attempts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  module_id TEXT NOT NULL,
  template_id TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  seed INTEGER NOT NULL,
  variant_id TEXT NOT NULL,
  title TEXT NOT NULL,
  instance TEXT NOT NULL,
  state TEXT NOT NULL,
  status TEXT NOT NULL,
  mode TEXT NOT NULL,
  source TEXT NOT NULL,
  assignment_id TEXT,
  recommendation TEXT,
  hints TEXT NOT NULL DEFAULT '[]',
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  evaluation TEXT,
  overall INTEGER,
  solved INTEGER,
  digest TEXT,
  skill_changes TEXT,
  coach TEXT,
  new_achievements TEXT,
  patterns TEXT,
  next TEXT,
  process_label TEXT,
  process_tone TEXT,
  duration_sec INTEGER,
  mistake_codes TEXT
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, status, completed_at);
CREATE TABLE IF NOT EXISTS attempt_actions (
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  t INTEGER NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  observation TEXT NOT NULL,
  annotations TEXT NOT NULL,
  message TEXT,
  message_tone TEXT,
  PRIMARY KEY (attempt_id, seq)
);
CREATE TABLE IF NOT EXISTS skill_states (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  state TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, skill_id)
);
CREATE TABLE IF NOT EXISTS skill_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  t INTEGER NOT NULL,
  score REAL NOT NULL,
  weight REAL NOT NULL,
  mastery_before REAL NOT NULL,
  mastery_after REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_skill_events_user ON skill_events(user_id, t);
CREATE TABLE IF NOT EXISTS mistake_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  attempt_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  code TEXT NOT NULL,
  severity TEXT NOT NULL,
  count INTEGER NOT NULL,
  t INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mistake_events_user ON mistake_events(user_id, t);
CREATE TABLE IF NOT EXISTS achievements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id TEXT NOT NULL,
  earned_at INTEGER NOT NULL,
  attempt_id TEXT,
  PRIMARY KEY (user_id, achievement_id)
);
CREATE TABLE IF NOT EXISTS coach_messages (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  provider TEXT NOT NULL,
  t INTEGER NOT NULL
);
`;

let db: DatabaseSync | null = null;
const stmtCache = new Map<string, ReturnType<DatabaseSync['prepare']>>();

export function openDb(path = DB_PATH): DatabaseSync {
  if (db) return db;
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);
  return db;
}

export function closeDb() {
  stmtCache.clear();
  db?.close();
  db = null;
}

function stmt(sql: string) {
  const d = openDb();
  let s = stmtCache.get(sql);
  if (!s) {
    s = d.prepare(sql);
    stmtCache.set(sql, s);
  }
  return s;
}

type Row = Record<string, any>;

export const q = {
  get<T = Row>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return stmt(sql).get(...params) as T | undefined;
  },
  all<T = Row>(sql: string, ...params: SQLInputValue[]): T[] {
    return stmt(sql).all(...params) as T[];
  },
  run(sql: string, ...params: SQLInputValue[]) {
    return stmt(sql).run(...params);
  },
};

export function tx<T>(fn: () => T): T {
  const d = openDb();
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  }
}

export function newId(prefix = ''): string {
  return prefix + randomBytes(9).toString('base64url');
}

export function json<T>(text: string | null | undefined, fallback: T): T {
  if (text === null || text === undefined || text === '') return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

/** Deletes every row (used by the seeder with --reset). */
export function resetDb() {
  const d = openDb();
  d.exec(`
    DELETE FROM coach_messages; DELETE FROM achievements; DELETE FROM mistake_events; DELETE FROM skill_events;
    DELETE FROM skill_states; DELETE FROM attempt_actions; DELETE FROM attempts; DELETE FROM assignments;
    DELETE FROM class_members; DELETE FROM classes; DELETE FROM sessions; DELETE FROM users;
  `);
}
