import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data')

// Cache open connections — one per user
const connections = {}

const SCHEMA = `
  -- Generic key-value metrics table.
  -- Adding a new metric (e.g. "ldl", "hrv", "vo2max") requires zero schema changes.
  CREATE TABLE IF NOT EXISTS metrics (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT    NOT NULL,
    metric     TEXT    NOT NULL,
    value      REAL    NOT NULL,
    source     TEXT    NOT NULL DEFAULT 'manual',
    notes      TEXT,
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(date, metric, source)
  );

  CREATE TABLE IF NOT EXISTS events (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    date       TEXT NOT NULL,
    type       TEXT NOT NULL,
    label      TEXT NOT NULL,
    notes      TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Per-marker reference range config, sourced from lab PDFs or hardcoded fallbacks.
  -- range_low/high = lab's printed normal range.
  -- optimal_low/high = tighter "ideal" zone (hardcoded; not overwritten by PDF import).
  CREATE TABLE IF NOT EXISTS marker_configs (
    metric       TEXT PRIMARY KEY,
    unit         TEXT,
    range_low    REAL,
    range_high   REAL,
    optimal_low  REAL,
    optimal_high REAL,
    source       TEXT NOT NULL DEFAULT 'hardcoded',
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_metrics_date    ON metrics(date);
  CREATE INDEX IF NOT EXISTS idx_metrics_metric  ON metrics(metric);
  CREATE INDEX IF NOT EXISTS idx_events_date     ON events(date);
`

export function getDb(userId) {
  if (connections[userId]) return connections[userId]

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  const dbPath = path.join(DATA_DIR, `${userId}.db`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')  // safe concurrent reads
  db.exec(SCHEMA)

  connections[userId] = db
  return db
}

// ── Users manifest ─────────────────────────────────────────────
const USERS_FILE = () => path.join(DATA_DIR, 'users.json')

export function readUsers() {
  const f = USERS_FILE()
  if (!fs.existsSync(f)) return []
  return JSON.parse(fs.readFileSync(f, 'utf8'))
}

export function writeUsers(users) {
  fs.writeFileSync(USERS_FILE(), JSON.stringify(users, null, 2))
}
