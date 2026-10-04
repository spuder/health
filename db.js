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

  // Same idea for imported reference ranges: remember which import wrote a
  // marker_configs row so deleting that report can take its ranges back out.
  // Without this a misparsed range (OCR reading an LDL footnote as 0–1.2)
  // outlives the import and silently misjudges every historical value, with no
  // UI to repair it. NULL for hardcoded rows and for pre-existing imports.
  try { db.exec(`ALTER TABLE marker_configs ADD COLUMN lab_report_id INTEGER REFERENCES lab_reports(id) ON DELETE SET NULL`) } catch {}

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

  // Backfill metrics.lab_report_id for rows written before that column existed.
  // Every legacy pdf_import row is unlinked, which is what made the delete
  // handler's date + metric fallback so destructive: several reports routinely
  // share a date, and by UNIQUE(date, metric, source) they all read the same
  // single metrics row, so deleting one report took its siblings' values with
  // it. Linking the rows that can be attributed shrinks that blast radius.
  //
  // Conservative on purpose: a row is claimed only when exactly one report
  // could own it — same date, and that marker named in exactly one report's
  // markers_json. Genuinely ambiguous rows (e.g. three InBody scans on one
  // date all listing the same eight markers) stay NULL; a wrong link would
  // delete the wrong data, which is worse than no link at all. Idempotent:
  // only ever reads rows that are still NULL, so re-running is a no-op.
  const orphanCount = db.prepare(`
    SELECT count(*) AS n FROM metrics WHERE source = 'pdf_import' AND lab_report_id IS NULL
  `).get().n

  if (orphanCount) {
    // (date, metric) → set of report ids naming that marker on that date
    const claims = new Map()
    for (const report of db.prepare(`SELECT id, date, markers_json FROM lab_reports`).all()) {
      let markers = []
      try { markers = JSON.parse(report.markers_json ?? '[]') } catch {}
      if (!Array.isArray(markers)) continue
      for (const metric of markers) {
        const key = JSON.stringify([report.date, metric])
        const owners = claims.get(key)
        if (owners) owners.add(report.id)
        else claims.set(key, new Set([report.id]))
      }
    }

    const orphans = db.prepare(`
      SELECT id, date, metric FROM metrics WHERE source = 'pdf_import' AND lab_report_id IS NULL
    `).all()
    const link = db.prepare(`UPDATE metrics SET lab_report_id = ? WHERE id = ? AND lab_report_id IS NULL`)

    let linked = 0
    db.transaction(() => {
      for (const row of orphans) {
        const owners = claims.get(JSON.stringify([row.date, row.metric]))
        if (!owners || owners.size !== 1) continue  // unclaimed or contested → leave it
        link.run(owners.values().next().value, row.id)
        linked++
      }
    })()

    if (linked) {
      console.log(`[db] ${userId}: linked ${linked}/${orphanCount} legacy pdf_import metrics to their lab report`)
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

// ── Connection lifecycle ───────────────────────────────────────
// Deleting a profile used to only rewrite users.json, which left both the
// cached handle and <userId>.db behind. Because ids are slugified from the
// display name, re-adding "Jane" slugs straight back to `jane`, getDb('jane')
// hands back the still-open connection to the old file, and the previous
// person's labs, DNA and protocols reappear under what the UI presents as a
// brand new profile. No restart needed — same process, same cache.

// Drop a user's cached connection and close it, so the next getDb() opens the
// file fresh (or creates it). Returns true if there was one to evict.
export function closeDb(userId) {
  const db = connections[userId]
  if (!db) return false
  delete connections[userId]
  try {
    db.close()  // checkpoints and removes the -wal/-shm sidecars
  } catch (err) {
    console.error(`[db] ${userId}: close failed — ${err.message}`)
  }
  return true
}

// Timestamp suffix shared by every archived artifact of one delete, so the
// pieces of a single profile stay visibly grouped on disk. ISO 8601 with the
// colons and dot swapped for dashes — colons are legal on APFS and ext4 but
// trip up enough tooling (scp, rsync targets, Windows bind mounts) to be worth
// avoiding in a name the user may well have to copy around to recover.
function archiveStamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

// Pick a non-colliding `<base>.deleted-<stamp>` next to the original.
function archiveTarget(base, stamp) {
  let target = `${base}.deleted-${stamp}`
  let n = 2
  while (fs.existsSync(target)) target = `${base}.deleted-${stamp}-${n++}`
  return target
}

/**
 * Retire a deleted user's SQLite file instead of unlinking it.
 *
 * This is medical data and the trigger is a single unconfirmed API call, so
 * nothing is destroyed: the connection is evicted and closed, then the file is
 * *renamed* aside to `<userId>.db.deleted-<timestamp>`. A rename within one
 * directory is atomic and copies no bytes, but it also reclaims no disk space
 * — the archives accumulate until somebody removes them by hand. That is the
 * intended trade.
 *
 * The -wal/-shm sidecars move to `<archive>-wal` / `<archive>-shm`, which is
 * exactly where SQLite looks for them relative to the renamed database, so the
 * archive stays openable as a set: `sqlite3 data/jane.db.deleted-<stamp>`.
 * close() normally checkpoints them away first; this covers the case where it
 * could not (e.g. the handle was never cached because the process restarted).
 *
 * Returns { archived, closed, files } — `archived` is false when the user never
 * had a database on disk, which is not an error.
 */
export function archiveUserDb(userId) {
  const closed = closeDb(userId)
  const dbPath = path.join(DATA_DIR, `${userId}.db`)
  if (!fs.existsSync(dbPath)) return { archived: false, closed, files: [] }

  const target = archiveTarget(dbPath, archiveStamp())
  fs.renameSync(dbPath, target)
  const files = [path.basename(target)]

  for (const suffix of ['-wal', '-shm']) {
    if (!fs.existsSync(dbPath + suffix)) continue
    fs.renameSync(dbPath + suffix, target + suffix)
    files.push(path.basename(target) + suffix)
  }

  return { archived: true, closed, files }
}

/**
 * Retire a deleted user's lab-PDF directory the same way.
 *
 * `DATA_DIR/pdfs/<userId>/` is per-user, so moving the whole directory to
 * `DATA_DIR/pdfs/<userId>.deleted-<timestamp>` can't strand another profile's
 * report. The archived name contains a `.`, which slugification strips, so no
 * future user id can ever resolve back into it.
 *
 * Deliberately NOT covered: the legacy flat PDFs that live directly in
 * `DATA_DIR/pdfs/`, which predate the per-user layout and may be referenced by
 * any user's lab_reports; and `DATA_DIR/dna/`, which is a single flat
 * content-addressed store (`<sha256><ext>`) shared by every profile, so two
 * people who upload the same raw-data export share one file on disk. Archiving
 * either would take files out from under a profile that still exists. They
 * stay put, and the deleted profile's metadata rows for them ride along inside
 * the archived .db.
 */
// Shared by the per-user artifact directories (pdfs/<id>/, dna/<id>/): rename
// the directory aside rather than removing it -- same trade as archiveUserDb,
// atomic and byte-free, reclaiming nothing until someone clears it by hand.
function archiveUserSubdir(parent, userId) {
  const dir = path.join(DATA_DIR, parent, userId)
  let stat
  try { stat = fs.statSync(dir) } catch { return { archived: false, dir: null } }
  if (!stat.isDirectory()) return { archived: false, dir: null }

  const target = archiveTarget(dir, archiveStamp())
  fs.renameSync(dir, target)
  return { archived: true, dir: `${parent}/${path.basename(target)}` }
}

export function archiveUserPdfs(userId) {
  return archiveUserSubdir('pdfs', userId)
}

// Only the per-user directory is archived. The legacy flat dna/ files are left
// in place on purpose: one content-addressed file can be shared by several
// profiles, and this profile's database cannot see the others' references.
export function archiveUserDna(userId) {
  return archiveUserSubdir('dna', userId)
}

// ── Retention ──────────────────────────────────────────────────────────
// Retention policy for everything this module sets aside instead of deleting:
// a deleted profile's `<id>.db.deleted-<stamp>` (plus its -wal/-shm and its
// pdfs/ and dna/ directories), and any `*.bak-*` snapshot.
//
//   Keep an archive for 90 days, then delete it by hand.
//
// Deliberately not automatic. These are medical records whose archive exists
// precisely because a single unconfirmed API call created it; a sweeper that
// deleted them on a timer would reintroduce the data loss the archive prevents.
// This only reports, so the artifacts stay visible instead of quietly consuming
// the volume. Returns the entries found, oldest first.
export const ARCHIVE_RETENTION_DAYS = 90

export function listRetainedArtifacts() {
  let names = []
  try { names = fs.readdirSync(DATA_DIR) } catch { return [] }

  const out = []
  for (const name of names) {
    if (!/\.deleted-|\.bak-/.test(name)) continue
    let stat
    try { stat = fs.statSync(path.join(DATA_DIR, name)) } catch { continue }
    const ageDays = Math.floor((Date.now() - stat.mtimeMs) / 86400000)
    out.push({ name, ageDays, bytes: stat.isDirectory() ? null : stat.size, stale: ageDays >= ARCHIVE_RETENTION_DAYS })
  }
  return out.sort((a, b) => b.ageDays - a.ageDays)
}
