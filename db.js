import Database from 'better-sqlite3'
import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import crypto from 'crypto'

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

  CREATE TABLE IF NOT EXISTS lab_reports (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    date         TEXT    NOT NULL,
    filename     TEXT    NOT NULL,
    file_hash    TEXT,
    source_type  TEXT,
    markers_json TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Raw DNA test files (23andMe/AncestryDNA/Nebula PDFs or raw-data .txt exports).
  -- Stored on disk under DATA_DIR/dna/<file_hash>.<ext>; this table just tracks metadata.
  CREATE TABLE IF NOT EXISTS dna_files (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    filename          TEXT    NOT NULL,
    original_filename TEXT,
    file_hash         TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  -- Manually-entered genetic traits (e.g. MTHFR C677T: CT). Optionally linked
  -- to the dna_files row it came from, for reference — not auto-parsed (yet).
  CREATE TABLE IF NOT EXISTS dna_traits (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    gene       TEXT    NOT NULL,
    variant    TEXT,
    genotype   TEXT,
    result     TEXT,
    notes      TEXT,
    file_id    INTEGER REFERENCES dna_files(id) ON DELETE SET NULL,
    source     TEXT    NOT NULL DEFAULT 'manual',
    created_at TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS protocols (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    month      TEXT    NOT NULL,
    name       TEXT    NOT NULL,
    color      TEXT    NOT NULL DEFAULT '#7c3aed',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sub_protocols (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    protocol_id INTEGER NOT NULL REFERENCES protocols(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL,
    sort_order  INTEGER NOT NULL DEFAULT 0,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_metrics_date    ON metrics(date);
  CREATE INDEX IF NOT EXISTS idx_metrics_metric  ON metrics(metric);
  CREATE INDEX IF NOT EXISTS idx_events_date     ON events(date);
  CREATE INDEX IF NOT EXISTS idx_protocols_month ON protocols(month);
  CREATE INDEX IF NOT EXISTS idx_dna_traits_gene ON dna_traits(gene);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_dna_files_hash ON dna_files(file_hash) WHERE file_hash IS NOT NULL;
`

export function getDb(userId) {
  if (connections[userId]) return connections[userId]

  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

  const dbPath = path.join(DATA_DIR, `${userId}.db`)
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')  // safe concurrent reads
  db.exec(SCHEMA)

  // Migrations for columns added after initial deploy
  try { db.exec(`ALTER TABLE lab_reports ADD COLUMN file_hash TEXT`) } catch {}
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_lab_reports_hash ON lab_reports(file_hash) WHERE file_hash IS NOT NULL`)
  try { db.exec(`ALTER TABLE lab_reports ADD COLUMN original_filename TEXT`) } catch {}

  // Links a metrics row back to the lab_reports import that wrote it, so a bad
  // import (wrong lab, wrong account) can be deleted cleanly instead of leaving
  // orphaned values behind. NULL for rows written before this column existed or
  // by non-lab-import sources (manual entry, Apple Health, etc.).
  try { db.exec(`ALTER TABLE metrics ADD COLUMN lab_report_id INTEGER REFERENCES lab_reports(id) ON DELETE SET NULL`) } catch {}
  db.exec(`CREATE INDEX IF NOT EXISTS idx_metrics_lab_report ON metrics(lab_report_id)`)

  // Backfill file_hash for any existing reports that don't have one yet
  const unhashed = db.prepare(`SELECT id, filename FROM lab_reports WHERE file_hash IS NULL`).all()
  if (unhashed.length) {
    const update = db.prepare(`UPDATE lab_reports SET file_hash = ? WHERE id = ?`)
    for (const row of unhashed) {
      const filePath = path.join(DATA_DIR, 'pdfs', row.filename)
      if (fs.existsSync(filePath)) {
        const hash = crypto.createHash('sha256')
          .update(fs.readFileSync(filePath))
          .digest('hex')
        try { update.run(hash, row.id) } catch {}
      }
    }
  }

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
