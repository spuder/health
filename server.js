import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { fileURLToPath } from 'url'
import multer from 'multer'

import Anthropic from '@anthropic-ai/sdk'
import { getDb, readUsers, writeUsers, archiveUserDb, archiveUserPdfs, archiveUserDna, listRetainedArtifacts, ARCHIVE_RETENTION_DAYS, DATA_DIR } from './db.js'

if (!process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_API_KEY === 'your_api_key_here') {
  console.error('FATAL: ANTHROPIC_API_KEY is not set. Add it to your .env file.')
  process.exit(1)
}

const anthropic = new Anthropic()  // reads ANTHROPIC_API_KEY from env

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
const upload = multer({ storage: multer.memoryStorage() })
const PORT = process.env.PORT || 3001

app.use(cors())
app.use(express.json({ limit: '50mb' }))
app.use(express.static(path.join(__dirname, 'client/dist')))

// ── Helpers ───────────────────────────────────────────────────

function requireUser(req, res, next) {
  const users = readUsers()
  const user = users.find(u => u.id === req.params.userId)
  if (!user) return res.status(404).json({ error: `User '${req.params.userId}' not found` })
  req.user = user
  next()
}

/**
 * Pivot flat metric rows into per-date objects.
 * Input:  [{ id, date, metric, value, source, notes }, ...]
 * Output: [{ date, source, notes, <metric>: value, ... }, ...]  sorted by date asc
 *
 * When the same date has the same metric from multiple sources, the later row (higher id) wins.
 */
function pivotMetrics(rows) {
  const byDate = {}
  for (const row of rows) {
    if (!byDate[row.date]) byDate[row.date] = { date: row.date }
    const entry = byDate[row.date]
    entry[row.metric] = row.value

    // `source` and `notes` describe the date, not whichever metric happened to be
    // iterated last. Assigning both unconditionally meant the pivoted row reported
    // an arbitrary source (LabsSection renders it), and -- worse -- that a later
    // metric carrying no note erased a real note typed against an earlier one.
    if (entry.source == null) entry.source = row.source
    else if (entry.source !== row.source && entry.source !== 'mixed') entry.source = 'mixed'
    if (entry.notes == null && row.notes != null) entry.notes = row.notes
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}

// Normalize free-typed marker names into the snake_case keys used as `metrics.metric`
// (e.g. "Total Testosterone" -> "total_testosterone").
function normalizeMetricKey(raw) {
  if (typeof raw !== 'string') return null
  const key = raw.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return key || null
}

// ─────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────

// A user id is a filesystem name (DATA_DIR/<id>.db) and an Express path
// segment, so it has to be non-empty and URL-safe. The old one-liner slug
// could return the empty string for any name without ASCII alphanumerics
// ("李雷", "!!!"): the duplicate check passed, getDb('') created `data/.db`,
// and then no route could ever match the empty `:userId`, so every subsequent
// call for that profile 404'd with no way to repair it from the UI.
//
// Accents are folded rather than dropped, so "José" is `jose` and not `jos`.
const MAX_USER_ID_LEN = 64

function slugifyUserId(name) {
  return name
    .normalize('NFKD')             // split accented letters into base + mark
    .replace(/[\u0300-\u036f]/g, '')  // drop the combining marks ("e" + accent -> "e")
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_USER_ID_LEN)
    .replace(/-+$/, '')            // the slice may have left a trailing dash
}

// Names written entirely in a non-Latin script slug to nothing. Rejecting them
// would mean this dashboard simply cannot hold a Chinese or Arabic name, so
// instead they get a generated handle: the id is only an internal key, and the
// display name is stored verbatim in `name` and is what the UI renders.
function fallbackUserId(users) {
  const taken = new Set(users.map(u => u.id))
  if (!taken.has('user')) return 'user'
  for (let n = 2; ; n++) {
    const candidate = `user-${n}`
    if (!taken.has(candidate)) return candidate
  }
}

app.get('/api/users', (req, res) => {
  res.json(readUsers())
})

app.post('/api/users', (req, res) => {
  const { name, color, initials, height_inches, birth_year } = req.body
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' })
  }

  const users = readUsers()
  const slug = slugifyUserId(name.trim())

  // Only the generated-handle path can collide on the display name instead of
  // the slug, so that's the only place it needs checking.
  if (!slug && users.find(u => u.name === name.trim())) {
    return res.status(409).json({ error: `A profile named '${name.trim()}' already exists` })
  }

  const id = slug || fallbackUserId(users)

  if (users.find(u => u.id === id)) {
    return res.status(409).json({ error: `User '${id}' already exists` })
  }

  const user = {
    id,
    name,
    color: color || '#7c3aed',
    initials: initials || name.slice(0, 2).toUpperCase(),
    height_inches: height_inches || null,
    birth_year: birth_year || null,
  }
  users.push(user)
  writeUsers(users)
  getDb(id)  // init DB immediately

  res.json({ ok: true, user })
})

app.patch('/api/users/:userId', requireUser, (req, res) => {
  const users = readUsers()
  const idx = users.findIndex(u => u.id === req.params.userId)
  const { birth_year, height_inches } = req.body
  if (birth_year != null) users[idx].birth_year = birth_year
  if (height_inches != null) users[idx].height_inches = height_inches
  writeUsers(users)
  res.json({ ok: true, user: users[idx] })
})

// Removing the manifest entry is not enough: the cached connection and the
// <userId>.db file both survive, so re-adding the same name (which slugs back
// to the same id) reopens the old database and resurrects the previous
// profile's entire history. Evict the handle and move the data aside.
//
// Archived, never deleted — see archiveUserDb/archiveUserPdfs in db.js for the
// naming and for what is deliberately left in place.
app.delete('/api/users/:userId', requireUser, (req, res) => {
  const { userId } = req.params

  // Manifest first: if an archive rename fails midway the profile is still
  // gone from the UI, rather than listed but holding a closed connection.
  writeUsers(readUsers().filter(u => u.id !== userId))

  const archived = { db: [], pdfs: null, dna: null }
  try {
    const db = archiveUserDb(userId)
    archived.db = db.files
    const pdfs = archiveUserPdfs(userId)
    if (pdfs.archived) archived.pdfs = pdfs.dir
    const dna = archiveUserDna(userId)
    if (dna.archived) archived.dna = dna.dir
  } catch (err) {
    console.error(`[users] ${userId}: archive failed — ${err.message}`)
    return res.status(500).json({
      error: `Profile '${userId}' was removed from the list, but its data could not be archived: ${err.message}`,
      archived,
    })
  }

  console.log(`[users] Deleted ${userId}; archived ${[...archived.db, archived.pdfs, archived.dna].filter(Boolean).join(', ') || 'nothing (no data on disk)'}`)
  res.json({ ok: true, archived })
})

// ─────────────────────────────────────────────────────────────
// Body  (metrics: weight, bmi, skeletal_muscle_mass, visceral_fat)
// ─────────────────────────────────────────────────────────────

const BODY_METRICS = [
  'weight', 'bmi', 'skeletal_muscle_mass', 'body_fat_mass', 'body_fat',
  'lean_mass', 'visceral_fat', 'bmr', 'total_body_water',
]

// Include list for GET /exercise. `GET /blood` is the complement of the four section
// lists, so anything a client reads but that is missing here silently shows up in Labs —
// which is exactly what happened to hr_hard_minutes (written by POST /exercise, read by
// ExerciseSection) until it was added below.
const EXERCISE_METRICS = [
  'exercise_minutes', 'workout_minutes', 'workout_count', 'hr_hard_minutes',
  'hr_z1_min', 'hr_z2_min', 'hr_z3_min', 'hr_z4_min', 'hr_z5_min',
]

const HEARTRATE_METRICS = ['resting_heart_rate', 'hrv', 'heart_rate']

app.get('/api/:userId/body', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const placeholders = BODY_METRICS.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT id, date, metric, value, source, notes, created_at
    FROM metrics
    WHERE metric IN (${placeholders})
    ORDER BY date ASC, id ASC
  `).all(...BODY_METRICS)

  const weightRows = db.prepare(
    `SELECT date, value, source FROM metrics WHERE metric = 'weight' ORDER BY date ASC`
  ).all()
  const weightBySource = {}
  for (const { date, value, source } of weightRows) {
    if (!weightBySource[source]) weightBySource[source] = []
    weightBySource[source].push({ date, value })
  }

  res.json({ height_inches: req.user.height_inches, entries: pivotMetrics(rows), weightBySource })
})

app.post('/api/:userId/body', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const { date, weight, bmi, skeletal_muscle_mass, visceral_fat, source = 'manual', notes } = req.body

  if (!date || weight == null) return res.status(400).json({ error: 'date and weight are required' })

  const upsert = db.prepare(`
    INSERT INTO metrics (date, metric, value, source, notes)
    VALUES (@date, @metric, @value, @source, @notes)
    ON CONFLICT(date, metric, source) DO UPDATE SET
      value = excluded.value,
      notes = excluded.notes
  `)

  const insertAll = db.transaction(() => {
    const base = { date, source, notes: notes ?? null }
    if (weight != null) upsert.run({ ...base, metric: 'weight', value: weight })
    if (bmi != null) upsert.run({ ...base, metric: 'bmi', value: bmi })
    if (skeletal_muscle_mass != null) upsert.run({ ...base, metric: 'skeletal_muscle_mass', value: skeletal_muscle_mass })
    if (visceral_fat != null) upsert.run({ ...base, metric: 'visceral_fat', value: visceral_fat })
  })

  insertAll()
  res.json({ ok: true })
})

app.delete('/api/:userId/body/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const placeholders = BODY_METRICS.map(() => '?').join(',')
  db.prepare(`DELETE FROM metrics WHERE id = ? AND metric IN (${placeholders})`).run(req.params.id, ...BODY_METRICS)
  res.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────
// Blood  (metrics: testosterone, triglycerides, + any future markers)
// ─────────────────────────────────────────────────────────────

const SLEEP_METRICS = ['sleep_hours', 'sleep_quality', 'deep_sleep_hours', 'rem_sleep_hours', 'core_sleep_hours', 'awake_hours', 'bedtime', 'wake_time']

// Parse "2026-07-08 23:10:31 -0600" → decimal hours (23.175)
function parseTimeToHours(str) {
  if (!str || typeof str !== 'string') return NaN
  const m = str.match(/(\d{2}):(\d{2}):(\d{2})/)
  if (!m) return NaN
  return parseInt(m[1]) + parseInt(m[2]) / 60 + parseInt(m[3]) / 3600
}

// Put a clock hour on one continuous axis for a night that crosses midnight, so
// "earlier" and "later" can be compared at all: evening hours keep their value,
// after-midnight hours become 24..42. The boundary is 18:00 rather than noon
// because a wake time can legitimately be 12:30 (12.5), and at a noon boundary
// that would sort as an evening hour and lose to a 07:00 wake. Nothing files a
// night that starts between 02:00 and 19:00 (those are discarded as naps), so no
// real bedtime lands in the 12..18 gap.
function nightHour(v) {
  return v < 18 ? v + 24 : v
}

// Ranges calibrated against Rythm Health's Optimal/Average/Out-of-Range classifications.
// range_low/high = outer boundary (Average zone). optimal_low/high = inner target (Optimal zone).
const BLOOD_MARKERS = {
  // Hormones — Rythm Health uses optimization targets, not standard lab population ranges
  testosterone: { unit: 'ng/dL', range_low: 300, range_high: 1000, optimal_low: 500, optimal_high: 900 },
  total_testosterone: { unit: 'ng/dL', range_low: 300, range_high: 1000, optimal_low: 500, optimal_high: 900 },
  free_testosterone: { unit: 'pg/mL', range_low: 46, range_high: 224, optimal_low: 120, optimal_high: 180 },
  estrogen: { unit: 'pg/mL', range_low: 10, range_high: 50, optimal_low: 20, optimal_high: 40 },
  estradiol: { unit: 'pg/mL', range_low: 10, range_high: 50, optimal_low: 20, optimal_high: 40 },
  shbg: { unit: 'nmol/L', range_low: 10, range_high: 57, optimal_low: 20, optimal_high: 40 },
  dhea_s: { unit: 'µg/dL', range_low: 80, range_high: 560, optimal_low: 200, optimal_high: 450 },
  cortisol: { unit: 'µg/dL', range_low: 6, range_high: 23, optimal_low: 10, optimal_high: 18 },
  igf1: { unit: 'ng/mL', range_low: 100, range_high: 303, optimal_low: 150, optimal_high: 250 },
  psa: { unit: 'ng/mL', range_low: 0, range_high: 4, optimal_low: 0, optimal_high: 2.5 },
  // Thyroid
  tsh: { unit: 'uIU/mL', range_low: 0.4, range_high: 4.0, optimal_low: 1.0, optimal_high: 2.5 },
  free_t3: { unit: 'pg/mL', range_low: 2.0, range_high: 4.4, optimal_low: 3.0, optimal_high: 4.0 },
  free_t4: { unit: 'ng/dL', range_low: 0.8, range_high: 1.8, optimal_low: 1.1, optimal_high: 1.5 },
  // Lipids — Rythm Health uses stricter optimal targets than standard labs
  total_cholesterol: { unit: 'mg/dL', range_low: 0, range_high: 200, optimal_low: 0, optimal_high: 150 },
  ldl: { unit: 'mg/dL', range_low: 0, range_high: 120, optimal_low: 0, optimal_high: 80 },
  hdl: { unit: 'mg/dL', range_low: 40, range_high: 100, optimal_low: 60, optimal_high: 100 },
  triglycerides: { unit: 'mg/dL', range_low: 0, range_high: 150, optimal_low: 0, optimal_high: 100 },
  apob: { unit: 'mg/dL', range_low: 0, range_high: 90, optimal_low: 0, optimal_high: 70 },
  remnant_cholesterol: { unit: 'mg/dL', range_low: 0, range_high: 30, optimal_low: 0, optimal_high: 18 },
  triglycerides_hdl_ratio: { unit: '', range_low: 0, range_high: 2.0, optimal_low: 0, optimal_high: 1.5 },
  total_cholesterol_hdl_ratio: { unit: '', range_low: 0, range_high: 3.5, optimal_low: 0, optimal_high: 3.0 },
  ldl_apob_ratio: { unit: '', range_low: 1.0, range_high: null, optimal_low: 1.2, optimal_high: null },
  // Blood sugar
  glucose: { unit: 'mg/dL', range_low: 70, range_high: 99, optimal_low: 75, optimal_high: 90 },
  hba1c: { unit: '%', range_low: 0, range_high: 5.7, optimal_low: 0, optimal_high: 5.2 },
  fructosamine: { unit: 'umol/L', range_low: 200, range_high: 285, optimal_low: 200, optimal_high: 270 },
  // Vitamins & minerals
  vitamin_d: { unit: 'ng/mL', range_low: 30, range_high: 100, optimal_low: 50, optimal_high: 80 },
  vitamin_b12: { unit: 'pg/mL', range_low: 200, range_high: 900, optimal_low: 400, optimal_high: 900 },
  ferritin: { unit: 'ng/mL', range_low: 30, range_high: 300, optimal_low: 100, optimal_high: 200 },
  iron: { unit: 'µg/dL', range_low: 60, range_high: 170, optimal_low: 80, optimal_high: 130 },
  magnesium: { unit: 'mg/dL', range_low: 1.7, range_high: 2.2, optimal_low: 1.9, optimal_high: 2.1 },
  calcium: { unit: 'mg/dL', range_low: 8.5, range_high: 10.5, optimal_low: 9.0, optimal_high: 10.0 },
  // Inflammation
  crp: { unit: 'mg/L', range_low: 0, range_high: 3.0, optimal_low: 0, optimal_high: 1.0 },
  hscrp: { unit: 'mg/L', range_low: 0, range_high: 1.0, optimal_low: 0, optimal_high: 0.5 },
  homocysteine: { unit: 'µmol/L', range_low: 0, range_high: 15, optimal_low: 0, optimal_high: 9 },
  // CBC
  white_blood_cells: { unit: '×10³/µL', range_low: 4.5, range_high: 11.0, optimal_low: 5.0, optimal_high: 7.0 },
  red_blood_cells: { unit: '×10⁶/µL', range_low: 4.5, range_high: 5.9, optimal_low: 4.7, optimal_high: 5.5 },
  hemoglobin: { unit: 'g/dL', range_low: 13.5, range_high: 17.5, optimal_low: 14.5, optimal_high: 17.0 },
  hematocrit: { unit: '%', range_low: 41, range_high: 53, optimal_low: 43, optimal_high: 50 },
  platelets: { unit: '×10³/µL', range_low: 150, range_high: 400, optimal_low: 150, optimal_high: 350 },
  neutrophils: { unit: '%', range_low: 40, range_high: 70, optimal_low: 50, optimal_high: 65 },
  lymphocytes: { unit: '%', range_low: 20, range_high: 40, optimal_low: 25, optimal_high: 38 },
  monocytes: { unit: '%', range_low: 2, range_high: 10, optimal_low: 3, optimal_high: 8 },
  eosinophils: { unit: '%', range_low: 0, range_high: 6, optimal_low: 0, optimal_high: 4 },
  basophils: { unit: '%', range_low: 0, range_high: 2, optimal_low: 0, optimal_high: 1 },
  // Metabolic panel
  sodium: { unit: 'mEq/L', range_low: 136, range_high: 145, optimal_low: 138, optimal_high: 142 },
  potassium: { unit: 'mEq/L', range_low: 3.5, range_high: 5.1, optimal_low: 4.0, optimal_high: 4.5 },
  creatinine: { unit: 'mg/dL', range_low: 0.6, range_high: 1.1, optimal_low: 0.7, optimal_high: 1.0 },
  egfr: { unit: 'mL/min', range_low: 60, range_high: 120, optimal_low: 90, optimal_high: 120 },
  bun: { unit: 'mg/dL', range_low: 7, range_high: 20, optimal_low: 10, optimal_high: 18 },
  uric_acid: { unit: 'mg/dL', range_low: 3.5, range_high: 7.0, optimal_low: 3.5, optimal_high: 6.0 },
  albumin: { unit: 'g/dL', range_low: 3.5, range_high: 5.0, optimal_low: 4.0, optimal_high: 5.0 },
  total_protein: { unit: 'g/dL', range_low: 6.0, range_high: 8.3, optimal_low: 6.5, optimal_high: 8.0 },
  globulin: { unit: 'g/dL', range_low: 1.5, range_high: 3.5, optimal_low: 2.0, optimal_high: 3.0 },
  // Liver
  alt: { unit: 'U/L', range_low: 7, range_high: 56, optimal_low: 7, optimal_high: 30 },
  ast: { unit: 'U/L', range_low: 10, range_high: 40, optimal_low: 10, optimal_high: 25 },
  ggt: { unit: 'U/L', range_low: 8, range_high: 40, optimal_low: 8, optimal_high: 25 },
  alkaline_phosphatase: { unit: 'U/L', range_low: 30, range_high: 120, optimal_low: 40, optimal_high: 80 },
  total_bilirubin: { unit: 'mg/dL', range_low: 0.2, range_high: 1.2, optimal_low: 0.2, optimal_high: 0.8 },
  // Semen analysis
  semen_volume: { unit: 'mL', range_low: 1.4, range_high: null },
  semen_ph: { unit: '', range_low: 7.2, range_high: null },
  sperm_progressive_motility: { unit: '%', range_low: 32, range_high: null, optimal_low: 50, optimal_high: null },
  sperm_non_progressive_motility: { unit: '%', range_low: null, range_high: null },
  sperm_non_motile: { unit: '%', range_low: null, range_high: 58 },
  total_sperm_motility: { unit: '%', range_low: 40, range_high: null, optimal_low: 65, optimal_high: null },
  sperm_morphology: { unit: '%', range_low: 4, range_high: null, optimal_low: 14, optimal_high: null },
  sperm_count_per_ml: { unit: 'M/mL', range_low: 15, range_high: null, optimal_low: 100, optimal_high: null },
  total_sperm_count: { unit: 'M', range_low: 39, range_high: null, optimal_low: 200, optimal_high: null },
  total_progressive_sperm_count: { unit: 'M', range_low: 12.5, range_high: null, optimal_low: 40, optimal_high: null },
  // Microplastics
  microplastics_total: { unit: '', range_low: 6, range_high: 21, optimal_low: 0, optimal_high: 6 },
  microplastics_30_70_um: { unit: '', range_low: 1, range_high: 4, optimal_low: 0, optimal_high: 1 },
  microplastics_10_30_um: { unit: '', range_low: 4, range_high: 10, optimal_low: 0, optimal_high: 3 },
  microplastics_under_10_um: { unit: '', range_low: 4, range_high: 12, optimal_low: 0, optimal_high: 3 },
}

app.get('/api/:userId/blood', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const exclude = [...BODY_METRICS, ...SLEEP_METRICS, ...EXERCISE_METRICS, ...HEARTRATE_METRICS]
  const placeholders = exclude.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT id, date, metric, value, source, notes, created_at
    FROM metrics
    WHERE metric NOT IN (${placeholders})
    ORDER BY date ASC, id ASC
  `).all(...exclude)

  // Start with hardcoded fallbacks, then overlay lab-sourced range_low/high from DB.
  // optimal_low/high always come from hardcoded values (tighter than lab normal range).
  const markers = structuredClone(BLOOD_MARKERS)
  const storedConfigs = db.prepare('SELECT * FROM marker_configs').all()
  for (const cfg of storedConfigs) {
    if (!markers[cfg.metric]) markers[cfg.metric] = {}
    if (cfg.range_low != null) markers[cfg.metric].range_low = cfg.range_low
    if (cfg.range_high != null) markers[cfg.metric].range_high = cfg.range_high
    if (cfg.unit) markers[cfg.metric].unit = cfg.unit
  }

  res.json({ markers, entries: pivotMetrics(rows) })
})

app.post('/api/:userId/blood', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const { date, testosterone, triglycerides, source = 'manual', notes } = req.body

  if (!date) return res.status(400).json({ error: 'date is required' })

  const upsert = db.prepare(`
    INSERT INTO metrics (date, metric, value, source, notes)
    VALUES (@date, @metric, @value, @source, @notes)
    ON CONFLICT(date, metric, source) DO UPDATE SET
      value = excluded.value,
      notes = excluded.notes
  `)

  const insertAll = db.transaction(() => {
    const base = { date, source, notes: notes ?? null }
    if (testosterone != null) upsert.run({ ...base, metric: 'testosterone', value: testosterone })
    if (triglycerides != null) upsert.run({ ...base, metric: 'triglycerides', value: triglycerides })
  })

  insertAll()
  res.json({ ok: true })
})

app.delete('/api/:userId/blood/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const exclude = [...BODY_METRICS, ...SLEEP_METRICS, ...EXERCISE_METRICS, ...HEARTRATE_METRICS]
  const placeholders = exclude.map(() => '?').join(',')
  db.prepare(`DELETE FROM metrics WHERE id = ? AND metric NOT IN (${placeholders})`).run(req.params.id, ...exclude)
  res.json({ ok: true })
})

// Merge/rename a marker in place — e.g. fold "total_testosterone" (mistakenly imported
// under the wrong name for a few reports) into "testosterone" so history reads as one series.
// Also handles a plain rename when `into` doesn't exist yet under any data.
//
// Per (date, source) pair, the target ("into") wins if a value already exists there — those
// rows are left under the original name and reported back as `conflicts` for manual review.
app.post('/api/:userId/markers/merge', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const from = normalizeMetricKey(req.body.from)
  const into = normalizeMetricKey(req.body.into)

  if (!from || !into) return res.status(400).json({ error: 'from and into are required' })
  if (from === into) return res.status(400).json({ error: '"from" and "into" must be different markers' })

  const fromRows = db.prepare(`SELECT id, date, source FROM metrics WHERE metric = ?`).all(from)
  const existsAtInto = db.prepare(`SELECT 1 FROM metrics WHERE date = ? AND metric = ? AND source = ?`)
  const rename = db.prepare(`UPDATE metrics SET metric = ? WHERE id = ?`)

  let merged = 0, conflicts = 0
  const mergedDates = new Set()
  const conflictDates = new Set()

  db.transaction(() => {
    for (const row of fromRows) {
      if (existsAtInto.get(row.date, into, row.source)) {
        conflicts++
        conflictDates.add(row.date)
        continue
      }
      rename.run(into, row.id)
      merged++
      mergedDates.add(row.date)
    }

    // Reference range / unit config: keep the target's if it already has one,
    // otherwise carry the source's config over. Only once `from` is actually empty —
    // if nothing moved, or conflicts left rows behind, those survivors still render
    // under the old name and still need their own unit/range.
    if (merged > 0 && conflicts === 0) {
      const intoHasConfig = db.prepare(`SELECT 1 FROM marker_configs WHERE metric = ?`).get(into)
      if (intoHasConfig) {
        db.prepare(`DELETE FROM marker_configs WHERE metric = ?`).run(from)
      } else {
        db.prepare(`UPDATE marker_configs SET metric = ? WHERE metric = ?`).run(into, from)
      }
    }

    // Cosmetic: relabel the marker in lab-report snapshots for the reports we actually
    // merged. Dates that still hold a `from` row are skipped — relabelling a half-merged
    // date would claim `into` for a report whose own value is still under `from`, which
    // also misdirects the date+marker fallback in DELETE /lab-reports/:id.
    const relabelDates = [...mergedDates].filter(d => !conflictDates.has(d))
    if (relabelDates.length) {
      const placeholders = relabelDates.map(() => '?').join(',')
      const reports = db.prepare(
        `SELECT id, markers_json FROM lab_reports WHERE date IN (${placeholders})`
      ).all(...relabelDates)
      const updateReport = db.prepare(`UPDATE lab_reports SET markers_json = ? WHERE id = ?`)
      for (const r of reports) {
        let names
        try { names = JSON.parse(r.markers_json ?? '[]') } catch { continue }
        if (!names.includes(from)) continue
        updateReport.run(JSON.stringify([...new Set(names.map(n => n === from ? into : n))]), r.id)
      }
    }
  })()

  res.json({ ok: true, merged, conflicts })
})

// ─────────────────────────────────────────────────────────────
// Sleep  (metrics: sleep_hours, sleep_quality, deep_sleep_hours, rem_sleep_hours)
// ─────────────────────────────────────────────────────────────

app.get('/api/:userId/sleep', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const placeholders = SLEEP_METRICS.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT id, date, metric, value, source, notes, created_at
    FROM metrics
    WHERE metric IN (${placeholders})
    ORDER BY date ASC, id ASC
  `).all(...SLEEP_METRICS)

  const entries = pivotMetrics(rows)

  // Multiple sources (e.g. Apple Watch + Pillow) each log their own bedtime/wake_time
  // for the same night. pivotMetrics keeps whichever source's row synced most recently,
  // which flip-flops on every re-sync. Override with the earliest-recorded bedtime and
  // latest-recorded wake_time across all of that night's sources instead.
  //
  // Both comparisons run through nightHour. wake_time used to use a raw `>`, which is
  // only right while every value is a morning hour: a source reporting an evening
  // wake (23.x) beat a real 07:00, because 23.5 > 7. On the night axis the 07:00
  // normalises to 31 and wins, and a legitimate 12:30 wake (36.5) still beats both.
  const byDate = {}
  for (const entry of entries) byDate[entry.date] = entry
  for (const row of rows) {
    const entry = byDate[row.date]
    if (row.metric === 'bedtime' && (entry.bedtime == null || nightHour(row.value) < nightHour(entry.bedtime))) {
      entry.bedtime = row.value
    }
    if (row.metric === 'wake_time' && (entry.wake_time == null || nightHour(row.value) > nightHour(entry.wake_time))) {
      entry.wake_time = row.value
    }
  }

  res.json({ entries })
})

app.post('/api/:userId/sleep', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const { date, sleep_hours, sleep_quality, deep_sleep_hours, rem_sleep_hours, source = 'manual', notes } = req.body

  if (!date || sleep_hours == null) return res.status(400).json({ error: 'date and sleep_hours are required' })

  const upsert = db.prepare(`
    INSERT INTO metrics (date, metric, value, source, notes)
    VALUES (@date, @metric, @value, @source, @notes)
    ON CONFLICT(date, metric, source) DO UPDATE SET
      value = excluded.value,
      notes = excluded.notes
  `)

  db.transaction(() => {
    const base = { date, source, notes: notes ?? null }
    if (sleep_hours != null) upsert.run({ ...base, metric: 'sleep_hours', value: sleep_hours })
    if (sleep_quality != null) upsert.run({ ...base, metric: 'sleep_quality', value: sleep_quality })
    if (deep_sleep_hours != null) upsert.run({ ...base, metric: 'deep_sleep_hours', value: deep_sleep_hours })
    if (rem_sleep_hours != null) upsert.run({ ...base, metric: 'rem_sleep_hours', value: rem_sleep_hours })
  })()

  res.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────
// Events
// ─────────────────────────────────────────────────────────────

app.get('/api/:userId/events', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const entries = db.prepare(`SELECT * FROM events ORDER BY date ASC`).all()
  res.json({ entries })
})

app.post('/api/:userId/events', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const { date, type, label, notes } = req.body

  if (!date || !type || !label) return res.status(400).json({ error: 'date, type and label required' })

  const info = db.prepare(`INSERT INTO events (date, type, label, notes) VALUES (?, ?, ?, ?)`)
    .run(date, type, label, notes ?? null)

  res.json({ ok: true, id: info.lastInsertRowid })
})

app.delete('/api/:userId/events/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  db.prepare(`DELETE FROM events WHERE id = ?`).run(req.params.id)
  res.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────
// Import stats  GET /api/:userId/import/stats
// ─────────────────────────────────────────────────────────────

app.get('/api/:userId/import/stats', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const row = db.prepare(`
    SELECT COUNT(DISTINCT date) as count, MAX(date) as last_date
    FROM metrics
    WHERE source = 'apple_health'
  `).get()
  res.json({ apple_health: { count: row.count, last_date: row.last_date } })
})

// ─────────────────────────────────────────────────────────────
// Apple Health Auto Export  POST /api/:userId/import/apple-health
//
// Fully dynamic — any HAE metric is stored without schema changes.
// To add a new metric, just add its mapping below (or let it pass through as-is).
// ─────────────────────────────────────────────────────────────

const HAE_METRIC_MAP = {
  // Body
  body_mass: 'weight',
  weight_body_mass: 'weight',
  body_fat_percentage: 'body_fat',
  lean_body_mass: 'lean_mass',
  body_mass_index: 'bmi',
  // Heart
  heart_rate: 'heart_rate',
  resting_heart_rate: 'resting_heart_rate',
  heart_rate_variability_sdnn: 'hrv',
  heart_rate_variability: 'hrv',
  // Activity
  apple_exercise_time: 'exercise_minutes',
  active_energy_burned: 'active_calories',
  active_energy: 'active_calories',
  basal_energy_burned: 'resting_calories',
  step_count: 'steps',
  walking_running_distance: 'distance_miles',
  physical_effort: 'physical_effort',
  // Other vitals
  vo2_max: 'vo2_max',
  blood_glucose: 'blood_glucose',
  blood_pressure_systolic: 'bp_systolic',
  blood_pressure_diastolic: 'bp_diastolic',
  blood_oxygen_saturation: 'blood_oxygen',
  respiratory_rate: 'respiratory_rate',
  body_temperature: 'body_temp_f',
  apple_sleeping_wrist_temperature: 'wrist_temp_c',
  // Sleep — HAE uses several names depending on version/settings
  sleep_analysis: 'sleep_hours',
  sleep_analysis_asleep: 'sleep_hours',
  sleep_analysis_in_bed: null,             // ignore in-bed time
  sleep_analysis_deep: 'deep_sleep_hours',
  sleep_analysis_deep_sleep: 'deep_sleep_hours',
  sleep_analysis_rem: 'rem_sleep_hours',
  sleep_analysis_rem_sleep: 'rem_sleep_hours',
  sleep_analysis_core: null,               // no field for core yet
  sleep_analysis_core_sleep: null,
}

// How several samples on the same calendar day collapse into the one row that
// UNIQUE(date, metric, source) allows, keyed on the MAPPED metric name.
//
//   'sum'  — cumulative over the day; a day's value is the total of its samples.
//            Apple ships these as ~1,440 one-minute buckets, so this is the one that
//            matters: without it the stored value was a single minute of the day.
//   'avg'  — an instantaneous reading sampled continuously; the day's representative
//            value is the mean of its samples.
//   'last' — already a once-a-day figure, or a deliberate discrete measurement; the
//            newest sample by timestamp supersedes the others.
//
// Anything not listed — including unmapped HAE names, which pass through as-is — gets
// HAE_AGGREGATION_DEFAULT. 'avg' is the safe default: an unknown metric that should have
// been summed comes out low but in the right ballpark, whereas summing an unknown
// instantaneous metric produces a number orders of magnitude too large with nothing to
// flag it as wrong.
const HAE_AGGREGATION = {
  // Cumulative
  active_calories: 'sum',
  resting_calories: 'sum',
  steps: 'sum',
  distance_miles: 'sum',
  exercise_minutes: 'sum',
  time_in_daylight: 'sum',
  // Sleep stage durations only reach this path when HAE sends sleep_analysis_* as plain
  // qty points; they are stage lengths, so a night's figure is their total. (The raw
  // per-stage interval and compound nightly paths above never get here.)
  sleep_hours: 'sum',
  deep_sleep_hours: 'sum',
  rem_sleep_hours: 'sum',
  core_sleep_hours: 'sum',
  awake_hours: 'sum',
  // Instantaneous, sampled many times a day → mean
  heart_rate: 'avg',
  hrv: 'avg',
  blood_oxygen: 'avg',
  respiratory_rate: 'avg',
  blood_glucose: 'avg',
  bp_systolic: 'avg',
  bp_diastolic: 'avg',
  body_temp_f: 'avg',
  wrist_temp_c: 'avg',
  physical_effort: 'avg',
  // One figure per day already, or a discrete measurement → newest wins
  weight: 'last',
  bmi: 'last',
  body_fat: 'last',
  lean_mass: 'last',
  resting_heart_rate: 'last',
  vo2_max: 'last',
}
const HAE_AGGREGATION_DEFAULT = 'avg'

// Linear HAE→stored-unit scale, keyed on the MAPPED metric name rather than the HAE one.
// Two HAE names map to `weight` (`body_mass` and the `weight_body_mass` alias), so a test
// on the HAE name only catches one of them — an export using the alias with units 'kg'
// would store ~80 next to the ~176 pound values already in the table, on the same axis.
// Scaling is kept separate from rounding so a day's samples can be accumulated at full
// precision and rounded once, instead of rounding every one-minute sample and summing the
// error.
function unitScale(metricName, units) {
  if (metricName === 'weight' && units === 'kg') return 2.20462
  if (metricName?.includes('sleep') && units === 'min') return 1 / 60
  return 1
}

// Decimals a converted value is stored at — sleep hours derived from minutes need two.
function roundValue(metricName, units, value) {
  const factor = metricName?.includes('sleep') && units === 'min' ? 100 : 10
  return Math.round(value * factor) / factor
}

app.post('/api/:userId/import/apple-health', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  // Log top-level keys and any date_of_birth / me / profile field
  const topKeys = Object.keys(req.body?.data ?? {})
  const me = req.body?.data?.me ?? req.body?.data?.profile ?? req.body?.data?.characteristics ?? null
  if (me || !req.user.birth_year) console.log('[import keys]', topKeys, '| me:', me)
  const metrics = req.body?.data?.metrics ?? []
  const bodyMass = metrics.find(m => m.name === 'body_mass')
  if (bodyMass) console.log('[import body_mass]', bodyMass.units, 'sample:', bodyMass.data?.[0])
  const sleepMetric = metrics.find(m => m.name === 'sleep_analysis')
  if (sleepMetric?.data?.length) {
    console.log(new Date().toISOString(), '[import received]', metrics.length, 'metrics; sleep_analysis points:', sleepMetric.data.length)
  }
  const stats = { imported: 0, skipped: 0 }

  const upsert = db.prepare(`
    INSERT INTO metrics (date, metric, value, source)
    VALUES (@date, @metric, @value, @source)
    ON CONFLICT(date, metric, source) DO UPDATE SET value = excluded.value
  `)

  // What a night already holds, so a clipped re-sync can be told apart from a
  // genuine correction before it overwrites anything.
  const readNight = db.prepare(`
    SELECT metric, value FROM metrics
    WHERE date = ? AND source = ? AND metric IN ('sleep_hours', 'bedtime')
  `)

  const workouts = req.body?.data?.workouts ?? []

  // Auto-extract birth year from HAE date_of_birth if not already set
  const dob = req.body?.data?.me?.date_of_birth
    ?? req.body?.data?.profile?.date_of_birth
    ?? req.body?.data?.date_of_birth
  if (dob && !req.user.birth_year) {
    const year = new Date(dob).getFullYear()
    if (year > 1900 && year < new Date().getFullYear()) {
      const users = readUsers()
      const idx = users.findIndex(u => u.id === req.params.userId)
      users[idx].birth_year = year
      writeUsers(users)
      req.user.birth_year = year
      console.log(`[import] auto-set birth_year=${year} for ${req.params.userId}`)
    }
  }

  const importAll = db.transaction(() => {
    // Accumulator for the generic `qty` path, keyed `${date}|${metric}`. It lives outside
    // the metrics loop on purpose: two HAE names can map onto the same metric in one
    // payload (`active_energy` and `active_energy_burned` both → active_calories), and
    // their samples belong in the same daily bucket.
    const daily = new Map()

    for (const { name, units, data = [] } of metrics) {
      const mappedName = name in HAE_METRIC_MAP ? HAE_METRIC_MAP[name] : name
      if (mappedName === null) { stats.skipped += data.length; continue }  // explicitly ignored metric
      const metricName = mappedName

      // With "Summarize Data" off, HAE sends sleep_analysis as raw per-stage intervals
      // (one row per Awake/Core/Deep/REM/Asleep/In Bed segment, per source) instead of a
      // single nightly summary. Each interval's own `date` field is just its literal
      // calendar day, NOT a "which night" grouping — a session starting just after
      // midnight and another starting that same evening can both land on the same
      // calendar date, so grouping by date alone merges two different nights together.
      // Instead, cluster intervals per source by time proximity (a multi-hour gap means
      // a new session), then file each cluster under a night the same way the old
      // nap-filter did: late-evening starts belong to the next calendar day.
      if (name === 'sleep_analysis' && data.some(p => 'value' in p && 'qty' in p && 'start' in p)) {
        const SESSION_GAP_HOURS = 4
        const bySource = new Map()
        for (const point of data) {
          if (!point.start || !point.end || isNaN(parseFloat(point.qty))) { stats.skipped++; continue }
          const src = point.source || 'apple_health'
          if (!bySource.has(src)) bySource.set(src, [])
          bySource.get(src).push(point)
        }

        // Clusters are accumulated per (source, ownerDate) rather than written immediately,
        // so a night that a wake disturbance splits into two clusters (e.g. asleep 9:52 PM,
        // briefly up, asleep again 1:12 AM) gets its stage totals summed together instead of
        // the second cluster's upsert silently overwriting the first.
        const byNight = new Map()

        const addCluster = (src, cluster) => {
          const start = cluster[0].start
          const startH = parseTimeToHours(start)
          let end = cluster[0].end
          const totals = { awake: 0, core: 0, deep: 0, rem: 0, asleep: 0 }
          for (const p of cluster) {
            const qty = parseFloat(p.qty)
            const stage = (p.value || '').toLowerCase()
            if (stage in totals) totals[stage] += qty
            if (new Date(p.end) > new Date(end)) end = p.end
          }

          let ownerDate = null
          if (!isNaN(startH) && startH >= 19) {
            const d = new Date(start.slice(0, 10) + 'T00:00:00')
            d.setDate(d.getDate() + 1)
            ownerDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
          } else if (!isNaN(startH) && startH < 2) {
            ownerDate = start.slice(0, 10)
          }

          console.log(new Date().toISOString(), '[sleep night]', JSON.stringify({
            ownerDate, source: src, start, end, startH, intervals: cluster.length, ...totals,
            verdict: ownerDate ? 'night→keep' : 'NAP/unparseable→skip',
          }))
          if (!ownerDate) { stats.skipped += cluster.length; return }

          const key = `${src}|${ownerDate}`
          if (!byNight.has(key)) {
            byNight.set(key, { src, ownerDate, start, end, awake: 0, core: 0, deep: 0, rem: 0, asleep: 0 })
          }
          const night = byNight.get(key)
          night.awake += totals.awake
          night.core += totals.core
          night.deep += totals.deep
          night.rem += totals.rem
          night.asleep += totals.asleep
          if (new Date(start) < new Date(night.start)) night.start = start
          if (new Date(end) > new Date(night.end)) night.end = end
        }

        for (const [src, points] of bySource) {
          points.sort((a, b) => new Date(a.start) - new Date(b.start))
          let cluster = []
          let clusterMaxEnd = null
          for (const point of points) {
            if (cluster.length && (new Date(point.start) - clusterMaxEnd) / 3600000 > SESSION_GAP_HOURS) {
              addCluster(src, cluster)
              cluster = []
              clusterMaxEnd = null
            }
            cluster.push(point)
            const end = new Date(point.end)
            if (!clusterMaxEnd || end > clusterMaxEnd) clusterMaxEnd = end
          }
          if (cluster.length) addCluster(src, cluster)
        }

        for (const night of byNight.values()) {
          // A night with no asleep time at all is not a night; skip it rather than
          // writing a row of zeros over a good one.
          const asleepHours = night.core + night.deep + night.rem + night.asleep
          if (!(asleepHours > 0)) { stats.skipped++; continue }

          // An export window that opens after midnight (an automation sending only
          // "today") delivers just the tail of a night: the cluster starts ~00:0x and
          // its totals cover the post-midnight part alone. Writing that over a
          // complete record truncates the night and drops bedtime to ~00:00.
          //
          // Refuse that one case: the stored night began in the evening, this one did
          // not, and this one is no longer. Deliberately narrow -- a genuinely shorter
          // night still starts in the evening, so the guard does not fire and the
          // correction still lands. A blanket MAX would instead ratchet, leaving a
          // night that was first recorded too long permanently uncorrectable.
          const newBedtime = parseTimeToHours(night.start)
          const prior = {}
          for (const r of readNight.all(night.ownerDate, night.src)) prior[r.metric] = r.value
          const storedBeganInEvening = prior.bedtime != null && nightHour(prior.bedtime) < 24
          const newBeganAfterMidnight = !isNaN(newBedtime) && nightHour(newBedtime) >= 24
          if (storedBeganInEvening && newBeganAfterMidnight &&
              prior.sleep_hours != null && asleepHours <= prior.sleep_hours) {
            console.log(new Date().toISOString(), '[sleep clipped]', JSON.stringify({
              ownerDate: night.ownerDate, source: night.src,
              stored: { bedtime: prior.bedtime, sleep_hours: prior.sleep_hours },
              incoming: { bedtime: Math.round(newBedtime * 100) / 100, sleep_hours: Math.round(asleepHours * 100) / 100 },
              verdict: 'post-midnight tail, not longer → kept stored night',
            }))
            stats.skipped++
            continue
          }

          const sleepFields = [
            ['sleep_hours', asleepHours],
            ['deep_sleep_hours', night.deep],
            ['rem_sleep_hours', night.rem],
            ['core_sleep_hours', night.core],
            ['awake_hours', night.awake],
            ['bedtime', parseTimeToHours(night.start)],
            ['wake_time', parseTimeToHours(night.end)],
          ]
          let stored = 0
          for (const [metric, value] of sleepFields) {
            // The night is known-good by this point, so write every field it has,
            // including the zero ones. The old `value > 0` meant a night with no deep
            // sleep kept the previous sync's deep figure, and a bedtime or wake time of
            // exactly 00:00 was dropped entirely.
            if (value != null && !isNaN(value) && value >= 0) {
              upsert.run({ date: night.ownerDate, metric, value: Math.round(value * 100) / 100, source: night.src, notes: null })
              stored++
            }
          }
          stats.imported += stored
          if (!stored) stats.skipped++
        }
        continue
      }

      // HAE sends sleep_analysis as a compound nightly object (totalSleep/rem/deep/core fields)
      // rather than a simple qty, when "Summarize Data" is on. Handle it separately.
      if (name === 'sleep_analysis' && data.some(p => 'totalSleep' in p)) {
        for (const point of data) {
          const startH = parseTimeToHours(point.sleepStart)
          console.log(new Date().toISOString(), '[sleep point]', JSON.stringify({
            source: point.source,
            date: point.date,
            sleepStart: point.sleepStart,
            sleepEnd: point.sleepEnd,
            parsedStartHour: startH,
            verdict: isNaN(startH) ? 'unparseable→skip' : (startH >= 2 && startH < 19 ? 'NAP→skip' : 'night→keep'),
          }))
          const date = point.date?.slice(0, 10)
          if (!date) { stats.skipped++; continue }
          // Skip naps — only process sessions starting between 7 PM and 2 AM
          if (!isNaN(startH) && startH >= 2 && startH < 19) { stats.skipped++; continue }
          const src = point.source ?? 'apple_health'
          // Same as the raw-interval path: a night with no total sleep is not a night.
          if (!(parseFloat(point.totalSleep) > 0)) { stats.skipped++; continue }
          const sleepFields = [
            { field: 'totalSleep', metric: 'sleep_hours' },
            { field: 'deep', metric: 'deep_sleep_hours' },
            { field: 'rem', metric: 'rem_sleep_hours' },
            { field: 'core', metric: 'core_sleep_hours' },
            { field: 'awake', metric: 'awake_hours' },
            { field: 'sleepStart', metric: 'bedtime', parse: parseTimeToHours },
            { field: 'sleepEnd', metric: 'wake_time', parse: parseTimeToHours },
          ]
          let stored = 0
          for (const { field, metric, parse } of sleepFields) {
            const val = parse ? parse(point[field]) : parseFloat(point[field])
            // `val > 0` for the stage fields had the same effect here as in the
            // raw-interval path: a zero-deep-sleep night kept the previous sync's figure.
            if (!isNaN(val)) {
              upsert.run({ date, metric, value: Math.round(val * 100) / 100, source: src, notes: null })
              stored++
            }
          }
          stats.imported += stored
          if (!stored) stats.skipped++
        }
        continue
      }

      // One HAE data point is a single sample, not a day. A cumulative metric such as
      // active_energy_burned arrives as ~1,440 one-minute buckets per day; writing each
      // one straight to (date, metric, 'apple_health') meant every sample overwrote the
      // previous one and the stored "daily" value was whichever sample happened to be
      // last in the array — which is why active_calories reads 0.0–1.2 per day against a
      // real ~500 kcal. Accumulate per (date, metric) here and collapse with the metric's
      // HAE_AGGREGATION policy after the loop.
      for (const point of data) {
        const date = point.date?.slice(0, 10)
        if (!date) { stats.skipped++; continue }

        const qty = parseFloat(point.qty)
        const raw = isNaN(qty) ? parseFloat(point.Avg ?? point.Max ?? point.Min) : qty
        if (isNaN(raw)) { stats.skipped++; continue }

        const key = `${date}|${metricName}`
        if (!daily.has(key)) {
          daily.set(key, {
            date,
            metric: metricName,
            units,
            policy: metricName in HAE_AGGREGATION ? HAE_AGGREGATION[metricName] : HAE_AGGREGATION_DEFAULT,
            total: 0, count: 0,       // every sample, for 'avg'
            sum: 0, sumCount: 0,      // qty samples only, for 'sum'
            last: null, lastTs: NaN,  // newest by timestamp, for 'last'
            max: -Infinity,
          })
        }
        const acc = daily.get(key)
        // Scale per sample so a payload mixing units for one metric still accumulates
        // coherently; rounding happens once, at flush.
        const value = raw * unitScale(metricName, units)
        acc.total += value
        acc.count++
        if (value > acc.max) acc.max = value
        // Fall back to array order when the timestamp is unparseable, which is what the
        // old overwrite-per-point behaviour effectively did.
        const ts = Date.parse(point.date)
        if (acc.last === null || isNaN(ts) || isNaN(acc.lastTs) || ts >= acc.lastTs) {
          acc.last = value
          acc.lastTs = ts
        }
        // An Avg/Min/Max point is already a summary over some window, so it never feeds a
        // 'sum' — a day of per-window averages has no meaningful total.
        if (!isNaN(qty)) { acc.sum += value; acc.sumCount++ }
      }
    }

    // Collapse the accumulated samples into the one row per (date, metric) that the
    // UNIQUE constraint allows.
    for (const acc of daily.values()) {
      let value
      if (acc.policy === 'sum') {
        // No qty samples at all means HAE pre-aggregated the day for us; keep the largest
        // of those summaries rather than inventing a total out of per-window averages.
        value = acc.sumCount ? acc.sum : acc.max
      } else if (acc.policy === 'avg') {
        value = acc.total / acc.count
      } else {
        value = acc.last
      }
      upsert.run({
        date: acc.date,
        metric: acc.metric,
        value: roundValue(acc.metric, acc.units, value),
        source: 'apple_health',
      })
      stats.imported++
    }

    // Aggregate workouts → workout_count + workout_minutes + HR zones per day.
    //
    // This used to write `exercise_minutes`, which the metrics loop above also writes
    // from apple_exercise_time. Same (date, metric, source) → last writer won, so the
    // value flip-flopped between syncs depending on which payload arrived last: of the
    // dates in this DB that have a workout_count, most read exercise_minutes = 1.0 (a
    // single one-minute apple_exercise_time sample) while a handful read 13/27/60/68 (the
    // workout-derived sum). The Exercise chart was plotting two incompatible quantities —
    // Apple's exercise-ring time and time spent in recorded workouts — so they get
    // separate metrics now.
    if (workouts.length) {
      const age = req.user.birth_year ? new Date().getFullYear() - req.user.birth_year : null
      const maxHR = age ? 220 - age : null
      const byDate = {}
      for (const w of workouts) {
        const date = w.start?.slice(0, 10)
        if (!date) continue
        if (!byDate[date]) byDate[date] = { count: 0, minutes: 0, z: [0, 0, 0, 0, 0], hasHr: false }
        byDate[date].count++
        // w.duration is in seconds. Confirmed against the stored results rather than the
        // comment: 2026-07-18 has one workout and 27 stored minutes, 2026-07-19 one and
        // 13 — minutes-valued durations would need a 27-hour workout to produce that, and
        // the per-day HR sample counts (25 and 7) track those figures at roughly one
        // sample a minute.
        byDate[date].minutes += (w.duration ?? 0) / 60

        // hr_z1_min…hr_z5_min are stored and rendered as MINUTES, so each sample has to
        // be weighted by the wall-clock interval it covers rather than counted. The old
        // `z[i]++` counted samples: the same 30-minute zone-2 workout exported at 5-second
        // HR sampling gave hr_z2_min = 360 and at one-minute sampling gave 30. The stored
        // values only look plausible because this export happens to run ~1 sample/minute.
        //
        // Keeping the field names (rather than renaming to hr_z*_samples) because the
        // client compares them against TARGET_HR_MINS and labels the axis in minutes — a
        // sample count has no goal to compare against and no fixed meaning across exports.
        if (maxHR && w.heartRateData?.length) {
          // A sample with no usable bpm is excluded outright. It used to fall through
          // `(d.Avg ?? 0)` and get bucketed as 0% — i.e. silently dropped into no zone,
          // but still counted toward the workout's sample total.
          const samples = w.heartRateData
            .map(d => ({
              bpm: parseFloat(d.Avg ?? d.qty ?? d.Max ?? d.Min),
              ts: Date.parse(d.date ?? d.start ?? d.startDate),
            }))
            .filter(s => !isNaN(s.bpm))
            .sort((a, b) => (isNaN(a.ts) ? 0 : a.ts) - (isNaN(b.ts) ? 0 : b.ts))

          // Fall back to an even split of the workout when timestamps are missing or a
          // gap is implausible (a paused recording must not inflate a zone).
          const MAX_GAP_MINUTES = 10
          const evenSplit = samples.length && w.duration > 0 ? (w.duration / 60) / samples.length : 1

          for (let i = 0; i < samples.length; i++) {
            const { bpm, ts } = samples[i]
            const next = samples[i + 1]
            let mins = evenSplit
            if (!isNaN(ts) && next && !isNaN(next.ts)) {
              const gap = (next.ts - ts) / 60000
              if (gap > 0 && gap <= MAX_GAP_MINUTES) mins = gap
            }

            const pct = bpm / maxHR * 100
            if (pct >= 90) byDate[date].z[4] += mins
            else if (pct >= 80) byDate[date].z[3] += mins
            else if (pct >= 70) byDate[date].z[2] += mins
            else if (pct >= 60) byDate[date].z[1] += mins
            else if (pct >= 50) byDate[date].z[0] += mins
          }
          if (samples.length) byDate[date].hasHr = true
        }
      }
      for (const [date, { count, minutes, z, hasHr }] of Object.entries(byDate)) {
        upsert.run({ date, metric: 'workout_count', value: count, source: 'apple_health' })
        upsert.run({ date, metric: 'workout_minutes', value: Math.round(minutes), source: 'apple_health' })
        stats.imported += 2
        // Write every zone, including the empty ones, whenever the day has HR data at
        // all. The old `if (mins > 0)` meant a zone that legitimately drops to zero on
        // re-import kept the previous sync's stale non-zero value forever. Days with no
        // HR data still write no zone rows, so "no zone data" stays distinguishable from
        // "zero minutes in that zone".
        if (hasHr) {
          z.forEach((mins, i) => {
            upsert.run({ date, metric: `hr_z${i + 1}_min`, value: Math.round(mins * 10) / 10, source: 'apple_health' })
            stats.imported++
          })
        }
      }
    }
  })

  try {
    importAll()
    res.json({ ok: true, ...stats })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// ─────────────────────────────────────────────────────────────
// Exercise  (metrics: exercise_minutes, workout_minutes, workout_count, hr_hard_minutes)
// ─────────────────────────────────────────────────────────────

app.get('/api/:userId/exercise', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const placeholders = EXERCISE_METRICS.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT id, date, metric, value, source, notes, created_at
    FROM metrics
    WHERE metric IN (${placeholders})
    ORDER BY date ASC, id ASC
  `).all(...EXERCISE_METRICS)

  res.json({ entries: pivotMetrics(rows) })
})

app.post('/api/:userId/exercise', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const { date, exercise_minutes, hr_hard_minutes, source = 'manual', notes } = req.body

  if (!date || exercise_minutes == null) return res.status(400).json({ error: 'date and exercise_minutes are required' })

  const upsert = db.prepare(`
    INSERT INTO metrics (date, metric, value, source, notes)
    VALUES (@date, @metric, @value, @source, @notes)
    ON CONFLICT(date, metric, source) DO UPDATE SET
      value = excluded.value,
      notes = excluded.notes
  `)

  db.transaction(() => {
    const base = { date, source, notes: notes ?? null }
    upsert.run({ ...base, metric: 'exercise_minutes', value: exercise_minutes })
    upsert.run({ ...base, metric: 'workout_count', value: 1 })
    if (hr_hard_minutes != null) upsert.run({ ...base, metric: 'hr_hard_minutes', value: hr_hard_minutes })
  })()

  res.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────
// Heart Rate  (metrics: resting_heart_rate, hrv, heart_rate)
// ─────────────────────────────────────────────────────────────

app.get('/api/:userId/heartrate', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const placeholders = HEARTRATE_METRICS.map(() => '?').join(',')
  const rows = db.prepare(`
    SELECT id, date, metric, value, source, notes, created_at
    FROM metrics
    WHERE metric IN (${placeholders})
    ORDER BY date ASC, id ASC
  `).all(...HEARTRATE_METRICS)

  res.json({ entries: pivotMetrics(rows) })
})

// ─────────────────────────────────────────────────────────────
// Labs PDF import  POST /api/:userId/import/labs-pdf
//
// 1. Extract text from PDF (text-based PDFs only — InBody, Quest, LabCorp, etc.)
// 2. Send to Claude to parse into structured metrics JSON
// 3. Upsert every metric into the metrics table (source = 'pdf_import')
// ─────────────────────────────────────────────────────────────

const LAB_SYSTEM_PROMPT = `You are a health data parser. Extract every health metric AND reference range from the report text provided. The text may be raw PDF extraction and appear garbled or out of order — do your best to find the numbers regardless.

You MUST always respond with valid JSON only. Never write natural language. Never say you cannot find data. If no metrics are found, return the JSON structure with empty metrics object.

Return ONLY valid JSON — no markdown, no explanation — in this exact shape:
{
  "date": "YYYY-MM-DD",
  "source_type": "inbody" | "blood_panel" | "other",
  "metrics": { "metric_name": numeric_value },
  "reference_ranges": {
    "metric_name": { "low": number_or_null, "high": number_or_null }
  }
}

General rules:
- date: the collection/scan date in YYYY-MM-DD. If only month+year found, use the 1st. Use null if truly absent.
- All metric values must be plain numbers (no units, no strings, no ranges).
- Use the result/measured value only for metrics.
- Omit any marker you are not confident about.
- Use lowercase snake_case for all metric names.

reference_ranges rules:
- Search the ENTIRE document for reference ranges — they may appear in a separate column, on the next line, in a footer, or in a section labeled "Reference Range", "Normal", "Optimal", "Ref Range", "Standard", etc.
- Match each range to the metric it belongs to, even if the range appears on a different line or after a label.
- Recognized formats (all of these should be captured):
    "300-1000" or "300 – 1000"  → { "low": 300,  "high": 1000 }
    "<150" or "< 150" or "≤150" → { "low": 0,    "high": 150  }
    ">40"  or "> 40"  or "≥40"  → { "low": 40,   "high": null }
    "0.4-4.0"                   → { "low": 0.4,  "high": 4.0  }
    "Optimal: 50-80"            → { "low": 50,   "high": 80   }
- If ranges are in a table column adjacent to values, associate them with the correct row's metric.
- If reference ranges appear anywhere in the document, do NOT return an empty reference_ranges object.
- Ratios and calculated values (e.g. triglycerides_hdl_ratio) may not have printed ranges — omit those.
- InBody body-composition scans do not print lab reference ranges — leave reference_ranges as {}.

Blood / lab panels (Rythm Health, Quest, LabCorp, etc.):
- source_type = "blood_panel"
- Use the marker name as written, lowercased and snake_cased, e.g.:
  testosterone, free_testosterone, triglycerides, hdl, ldl, total_cholesterol,
  glucose, hba1c, tsh, free_t3, free_t4, ferritin, iron, vitamin_d, vitamin_b12,
  homocysteine, crp, hscrp, cortisol, dhea_s, igf1, psa, estradiol, shbg,
  red_blood_cells, white_blood_cells, hemoglobin, hematocrit, platelets,
  neutrophils, lymphocytes, monocytes, eosinophils, basophils,
  sodium, potassium, chloride, bicarbonate, bun, creatinine, egfr,
  calcium, magnesium, phosphorus, uric_acid, alt, ast, ggt, alkaline_phosphatase,
  total_bilirubin, total_protein, albumin, globulin

InBody body-composition scans:
- source_type = "inbody"
- Use these exact keys:
  weight               → lbs
  skeletal_muscle_mass → lbs
  body_fat_mass        → lbs
  body_fat             → percent as a number (e.g. 15.2 for 15.2%)
  bmi                  → numeric
  visceral_fat         → InBody level score (integer 1–20)
  bmr                  → kcal
  total_body_water     → liters`

// ── Lab file storage ──────────────────────────────────────────
// New uploads go to DATA_DIR/pdfs/<userId>/<hash><ext>. The old flat
// DATA_DIR/pdfs/<name> layout was shared by every user, so two people
// importing the same family lab PDF got one file on disk under one name and
// either one's delete unlinked it out from under the other.
//
// Reads have to stay compatible with three legacy flat names already on disk
// ('ocr_import', '<user>_<date>_<ts>.pdf', '<hash>.PDF'), so lookups try the
// per-user path first and then fall back to the flat one.

function labPdfDir(userId) {
  return path.join(DATA_DIR, 'pdfs', userId)
}

function resolveLabPdfPath(userId, filename) {
  if (!filename) return null
  const root = path.resolve(path.join(DATA_DIR, 'pdfs'))
  const candidates = [
    path.join(root, userId, path.basename(filename)),  // per-user layout
    path.join(root, filename),                          // legacy flat layout
  ]
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (!resolved.startsWith(root + path.sep)) continue  // never escape pdfs/
    try {
      if (fs.statSync(resolved).isFile()) return resolved
    } catch {}
  }
  return null
}

// A file is written at preview time, before any lab_reports row exists, so an
// abandoned preview leaves an orphaned medical PDF on disk that no UI can
// remove. Sweep this user's own upload dir whenever they import again:
// unreferenced files older than a day, i.e. long past any open preview.
// Legacy flat files in pdfs/ are deliberately never swept — they can belong to
// another user's report, which this DB cannot see.
const ORPHAN_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000

function sweepAbandonedUploads(db, userId) {
  let entries
  try { entries = fs.readdirSync(labPdfDir(userId)) } catch { return }
  if (!entries.length) return

  const referenced = new Set(
    db.prepare(`SELECT filename FROM lab_reports WHERE filename IS NOT NULL`)
      .all()
      .map(r => path.basename(r.filename))
  )
  const cutoff = Date.now() - ORPHAN_UPLOAD_TTL_MS

  for (const name of entries) {
    if (referenced.has(name)) continue
    const filePath = path.join(labPdfDir(userId), name)
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.mtimeMs > cutoff) continue
      fs.unlinkSync(filePath)
      console.log(`[labs-pdf] Swept abandoned upload ${userId}/${name}`)
    } catch {}
  }
}

app.get('/api/:userId/lab-reports', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const reports = db.prepare(`SELECT * FROM lab_reports ORDER BY date DESC, created_at DESC`).all()
  res.json({ reports: reports.map(r => ({ ...r, markers: JSON.parse(r.markers_json ?? '[]') })) })
})

app.get('/api/:userId/lab-reports/:id/pdf', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const report = db.prepare(`SELECT * FROM lab_reports WHERE id = ?`).get(req.params.id)
  if (!report) return res.status(404).json({ error: 'Report not found' })

  const pdfPath = resolveLabPdfPath(req.params.userId, report.filename)
  if (!pdfPath) return res.status(404).json({ error: 'PDF file not found' })

  const downloadName = path.basename(report.original_filename || report.filename)
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/"/g, '')
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Disposition', `inline; filename="${downloadName}"`)
  fs.createReadStream(pdfPath).pipe(res)
})

// Undo a bad lab import — wrong file, wrong lab, wrong account, etc.
// Removes the report row, every metric value it wrote, and the stored file.
app.delete('/api/:userId/lab-reports/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const report = db.prepare(`SELECT * FROM lab_reports WHERE id = ?`).get(req.params.id)
  if (!report) return res.status(404).json({ error: 'Report not found' })

  let markerNames = []
  try { markerNames = JSON.parse(report.markers_json ?? '[]') } catch {}

  // Other rows that point at the same stored file. The UNIQUE index is on
  // file_hash (NULL for legacy rows), not filename, so siblings genuinely
  // share a name — reports 1-3 in spencer.db are all 'ocr_import'.
  const fileSiblings = report.filename
    ? db.prepare(`SELECT count(*) AS n FROM lab_reports WHERE id != ? AND filename = ?`)
        .get(report.id, report.filename).n
    : 0

  const result = db.transaction(() => {
    // Metrics explicitly stamped with this report's id.
    const linked = db.prepare(`DELETE FROM metrics WHERE lab_report_id = ?`).run(report.id)

    // Legacy fallback for reports imported before lab_report_id existed —
    // match by date + metric name among still-unlinked rows.
    //
    // That used to be justified with "no other (properly linked) report owns
    // these", which only holds if the other owner IS linked. In the real
    // databases nothing was: every pdf_import row predates the column. And
    // reports share dates constantly (three InBody scans on 2026-05-15, seven
    // panels on 2026-05-18), where UNIQUE(date, metric, source) means all of
    // them read one single row — so deleting one wiped the values its siblings
    // still list, leaving them in the UI with empty charts and no undo.
    //
    // So: only claim markers that no other report on this date lists. If every
    // marker is contested nothing is deleted by name, and the rows stay until
    // the db.js backfill can attribute them (or forever, if it never can).
    let legacyChanges = 0
    let skipped = []
    if (markerNames.length) {
      const shared = new Set()
      const sameDate = db.prepare(`SELECT markers_json FROM lab_reports WHERE id != ? AND date = ?`)
        .all(report.id, report.date)
      for (const other of sameDate) {
        let markers = []
        try { markers = JSON.parse(other.markers_json ?? '[]') } catch {}
        if (Array.isArray(markers)) for (const metric of markers) shared.add(metric)
      }

      const exclusive = markerNames.filter(m => !shared.has(m))
      skipped = markerNames.filter(m => shared.has(m))

      if (exclusive.length) {
        const placeholders = exclusive.map(() => '?').join(',')
        legacyChanges = db.prepare(`
          DELETE FROM metrics
          WHERE source = 'pdf_import' AND lab_report_id IS NULL AND date = ? AND metric IN (${placeholders})
        `).run(report.date, ...exclusive).changes
      }
    }

    // Reference ranges this import wrote. Removing them lets GET /blood fall
    // back to the hardcoded BLOOD_MARKERS baseline instead of judging every
    // historical value of the marker against a range from a deleted report.
    const ranges = db.prepare(`DELETE FROM marker_configs WHERE lab_report_id = ?`).run(report.id)

    db.prepare(`DELETE FROM lab_reports WHERE id = ?`).run(report.id)
    return { deletedMetrics: linked.changes + legacyChanges, deletedRanges: ranges.changes, skipped }
  })()

  // Only a file under pdfs/<userId>/ is provably this user's. A legacy flat
  // path can be the very same file another user's report points at (same
  // sha256, both imported it) and this DB cannot see theirs, so leave it.
  const storedPath = resolveLabPdfPath(req.params.userId, report.filename)
  const ownDir = path.resolve(labPdfDir(req.params.userId)) + path.sep
  if (storedPath && !fileSiblings && storedPath.startsWith(ownDir)) {
    fs.unlink(storedPath, () => {})
  } else if (storedPath) {
    const why = fileSiblings ? `${fileSiblings} other report(s) reference it` : 'shared legacy path'
    console.log(`[lab-reports] Kept ${report.filename} on disk — ${why}`)
  }

  if (result.skipped.length) {
    console.log(`[lab-reports] Report ${report.id}: left ${result.skipped.length} unlinked legacy metric(s) in place — also listed by another report on ${report.date}: ${result.skipped.join(', ')}`)
  }
  console.log(`[lab-reports] Deleted report ${report.id} (${report.date}, ${report.original_filename ?? report.filename}) — ${result.deletedMetrics} metrics, ${result.deletedRanges} ranges removed`)
  res.json({
    ok: true,
    deleted_metrics: result.deletedMetrics,
    deleted_ranges: result.deletedRanges,
    kept_shared_metrics: result.skipped,
  })
})

app.post('/api/:userId/import/labs-pdf', requireUser, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })

  const nameLower = req.file.originalname?.toLowerCase() ?? ''
  const isCsv = nameLower.endsWith('.csv')
  const isPng = nameLower.endsWith('.png')

  // ── 0. Duplicate check ────────────────────────────────────
  const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex')
  const db0 = getDb(req.params.userId)
  const existing = db0.prepare(`SELECT id, date FROM lab_reports WHERE file_hash = ?`).get(fileHash)
  if (existing) {
    return res.status(409).json({ error: `Duplicate: this file was already imported (report from ${existing.date})` })
  }

  // ── 0b. Persist the uploaded file to disk ─────────────────
  const ext = path.extname(req.file.originalname || '') || (isCsv ? '.csv' : isPng ? '.png' : '.pdf')
  // Per-user directory — see labPdfDir(). The DB keeps the bare basename, so
  // resolveLabPdfPath() is what maps a row to a file in either layout.
  const storedFilename = `${fileHash}${ext}`
  const userPdfsDir = labPdfDir(req.params.userId)
  fs.mkdirSync(userPdfsDir, { recursive: true })
  sweepAbandonedUploads(db0, req.params.userId)
  fs.writeFileSync(path.join(userPdfsDir, storedFilename), req.file.buffer)

  // ── 1. Send file to Claude ────────────────────────────────
  let parsed
  try {
    const userContent = isCsv
      ? [{ type: 'text', text: `Extract all health metrics from this CSV health report and return only the JSON.\n\n${req.file.buffer.toString('utf8')}` }]
      : isPng
        ? [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: req.file.buffer.toString('base64') } },
          { type: 'text', text: 'Extract all health metrics from this health report image and return only the JSON.' },
        ]
        : [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: req.file.buffer.toString('base64') } },
          { type: 'text', text: 'Extract all health metrics from this health report and return only the JSON.' },
        ]

    const msg = await anthropic.messages.create({
      model: 'claude-opus-5',
      max_tokens: 16000,
      system: LAB_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    if (msg.stop_reason === 'max_tokens') {
      throw new Error('Response too large — try a shorter file or split it into sections')
    }

    // A refusal is an HTTP 200 with no text block at all, which otherwise
    // surfaces as the misleading "Empty response from AI". stop_details is
    // populated only for this stop_reason.
    if (msg.stop_reason === 'refusal') {
      const why = msg.stop_details?.explanation || msg.stop_details?.category || 'no explanation given'
      throw new Error(`The AI declined to parse this file: ${why}`)
    }

    // Opus 5 thinks by default, so content[0] is a (text-less) thinking block,
    // not the answer. Join every text block rather than taking the first one:
    // the answer can arrive split across blocks, or behind a preamble block.
    const raw = msg.content.filter(b => b.type === 'text').map(b => b.text ?? '').join('').trim()
    if (!raw) throw new Error('Empty response from AI')
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    try {
      parsed = JSON.parse(jsonStr)
    } catch {
      // Prose around the JSON ("Here is the JSON:") — take the outermost object.
      const start = jsonStr.indexOf('{')
      const end = jsonStr.lastIndexOf('}')
      if (start === -1 || end <= start) throw new Error('AI response was not JSON')
      parsed = JSON.parse(jsonStr.slice(start, end + 1))
    }
  } catch (err) {
    console.error('[labs-pdf] Claude parse error:', err)
    return res.status(500).json({ error: `AI parsing failed: ${err.message}` })
  }

  // ── Phase 1: debug — print result, skip DB write ─────────
  console.log('[labs-pdf] Claude OCR result:')
  console.log(JSON.stringify(parsed, null, 2))

  res.json({ ok: true, debug: true, parsed, file_hash: fileHash, filename: storedFilename, original_filename: req.file.originalname })
})

// ─────────────────────────────────────────────────────────────
// Confirm OCR import  POST /api/:userId/import/labs-confirm
//
// Accepts pre-parsed JSON from the client (after user reviews/toggles).
// Writes selected metrics + reference ranges to DB.
// ─────────────────────────────────────────────────────────────

app.post('/api/:userId/import/labs-confirm', requireUser, (req, res) => {
  const { date, source_type, metrics, reference_ranges, file_hash, filename, original_filename } = req.body
  if (!date || !metrics) return res.status(400).json({ error: 'date and metrics are required' })

  const validMetrics = Object.entries(metrics)
    .filter(([, v]) => v != null && !isNaN(Number(v)))

  if (!validMetrics.length) return res.status(422).json({ error: 'No numeric metrics to save' })

  const db = getDb(req.params.userId)

  const upsert = db.prepare(`
    INSERT INTO metrics (date, metric, value, source, notes, lab_report_id)
    VALUES (@date, @metric, @value, @source, @notes, @lab_report_id)
    ON CONFLICT(date, metric, source) DO UPDATE SET
      value = excluded.value,
      notes = excluded.notes,
      lab_report_id = excluded.lab_report_id
  `)

  // optimal_low/optimal_high are deliberately absent from this statement (both
  // on insert and on conflict): they only ever come from the hardcoded
  // BLOOD_MARKERS table, never from a lab's printed range.
  const rangeUpsert = db.prepare(`
    INSERT INTO marker_configs (metric, range_low, range_high, source, lab_report_id, updated_at)
    VALUES (@metric, @range_low, @range_high, 'pdf_import', @lab_report_id, datetime('now'))
    ON CONFLICT(metric) DO UPDATE SET
      range_low     = COALESCE(excluded.range_low,  range_low),
      range_high    = COALESCE(excluded.range_high, range_high),
      source        = 'pdf_import',
      lab_report_id = excluded.lab_report_id,
      updated_at    = excluded.updated_at
  `)

  const markerNames = validMetrics.map(([k]) => k)
  const selected = new Set(markerNames)

  // Ranges for the markers the user actually kept, not every marker the OCR
  // saw. reference_ranges arrives straight from the parse, so an unchecked
  // marker used to still get its printed range written — and GET /blood then
  // overlaid that range on every historical value of a marker this import
  // never imported, with no UI to undo it.
  const selectedRanges = Object.entries(reference_ranges ?? {})
    .filter(([metric, range]) => selected.has(metric) && range && typeof range === 'object')

  try {
    db.transaction(() => {
      // Insert the report row first so its id can be stamped onto every metric
      // it writes — that's what lets a bad import be deleted cleanly later.
      const { lastInsertRowid: reportId } = db.prepare(`
        INSERT INTO lab_reports (date, filename, original_filename, source_type, markers_json, file_hash)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(date, filename ?? 'unknown', original_filename ?? null, source_type ?? 'other', JSON.stringify(markerNames), file_hash ?? null)

      for (const [metric, value] of validMetrics) {
        upsert.run({ date, metric, value: Number(value), source: 'pdf_import', notes: null, lab_report_id: reportId })
      }
      for (const [metric, { low, high }] of selectedRanges) {
        if (low == null && high == null) continue
        rangeUpsert.run({ metric, range_low: low ?? null, range_high: high ?? null, lab_report_id: reportId })
      }
    })()
    console.log(`[labs-confirm] Saved ${validMetrics.length} metrics and ${selectedRanges.length} ranges for ${req.params.userId}`)
    res.json({ ok: true, count: validMetrics.length, markers_found: markerNames, ranges_saved: selectedRanges.length })
  } catch (err) {
    console.error('[labs-confirm] DB write error:', err)
    res.status(500).json({ error: `Database write failed: ${err.message}` })
  }
})

// ─────────────────────────────────────────────────────────────
// DNA
//
// Two independent pieces, on purpose:
// 1. dna_files  — raw test files (PDF/HTML summary or .txt raw-data export)
//                 uploaded for safekeeping/reference. Not parsed yet.
// 2. dna_traits — genetic traits (e.g. "MTHFR C677T: CT") typed in by hand.
//                 Optionally references the file they were read off of.
// ─────────────────────────────────────────────────────────────

const DNA_MAX_BYTES = 30 * 1024 * 1024 // raw 23andMe/AncestryDNA exports run 15-25MB

app.get('/api/:userId/dna', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const traits = db.prepare(`SELECT * FROM dna_traits ORDER BY gene ASC, id ASC`).all()
  const files = db.prepare(`SELECT * FROM dna_files ORDER BY created_at DESC, id DESC`).all()
  res.json({ traits, files })
})

app.post('/api/:userId/dna/traits', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const { gene, variant, genotype, result, notes, file_id } = req.body
  if (!gene || !gene.trim()) return res.status(400).json({ error: 'gene is required' })

  const info = db.prepare(`
    INSERT INTO dna_traits (gene, variant, genotype, result, notes, file_id, source)
    VALUES (@gene, @variant, @genotype, @result, @notes, @file_id, 'manual')
  `).run({
    gene: gene.trim(),
    variant: variant?.trim() || null,
    genotype: genotype?.trim() || null,
    result: result?.trim() || null,
    notes: notes?.trim() || null,
    file_id: file_id ?? null,
  })
  const trait = db.prepare(`SELECT * FROM dna_traits WHERE id = ?`).get(info.lastInsertRowid)
  res.json(trait)
})

app.patch('/api/:userId/dna/traits/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const existing = db.prepare(`SELECT * FROM dna_traits WHERE id = ?`).get(req.params.id)
  if (!existing) return res.status(404).json({ error: 'Trait not found' })

  const { gene, variant, genotype, result, notes, file_id } = req.body
  if (gene !== undefined && !gene.trim()) return res.status(400).json({ error: 'gene cannot be empty' })

  db.prepare(`
    UPDATE dna_traits SET
      gene       = @gene,
      variant    = @variant,
      genotype   = @genotype,
      result     = @result,
      notes      = @notes,
      file_id    = @file_id,
      updated_at = datetime('now')
    WHERE id = @id
  `).run({
    id: req.params.id,
    gene: gene !== undefined ? gene.trim() : existing.gene,
    variant: variant !== undefined ? (variant?.trim() || null) : existing.variant,
    genotype: genotype !== undefined ? (genotype?.trim() || null) : existing.genotype,
    result: result !== undefined ? (result?.trim() || null) : existing.result,
    notes: notes !== undefined ? (notes?.trim() || null) : existing.notes,
    file_id: file_id !== undefined ? file_id : existing.file_id,
  })
  res.json(db.prepare(`SELECT * FROM dna_traits WHERE id = ?`).get(req.params.id))
})

app.delete('/api/:userId/dna/traits/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  db.prepare(`DELETE FROM dna_traits WHERE id = ?`).run(req.params.id)
  res.json({ ok: true })
})

// DNA files were written to one flat, content-addressed DATA_DIR/dna/ shared by
// every profile. Because the upload de-dupe check is per-user, two people who
// upload the same raw-data export both get a dna_files row pointing at the one
// file on disk -- and a delete by either unlinked it out from under the other.
// New uploads go under dna/<userId>/; this resolves both layouts so the files
// already on disk keep serving.
function resolveDnaFilePath(userId, filename) {
  if (!filename) return null
  const root = path.resolve(path.join(DATA_DIR, 'dna'))
  const candidates = [
    path.join(root, userId, path.basename(filename)),  // per-user layout
    path.join(root, filename),                          // legacy flat layout
  ]
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (!resolved.startsWith(root + path.sep)) continue  // never escape dna/
    try {
      if (fs.statSync(resolved).isFile()) return resolved
    } catch {}
  }
  return null
}

app.post('/api/:userId/dna/upload', requireUser, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' })
  if (req.file.size > DNA_MAX_BYTES) {
    return res.status(413).json({ error: `File too large — max ${DNA_MAX_BYTES / 1024 / 1024}MB` })
  }

  const nameLower = req.file.originalname?.toLowerCase() ?? ''
  const ext = nameLower.endsWith('.txt') ? '.txt'
    : nameLower.endsWith('.pdf') ? '.pdf'
    : nameLower.endsWith('.html') ? '.html'
    : nameLower.endsWith('.htm') ? '.html'
    : null
  if (!ext) return res.status(400).json({ error: 'Only .pdf, .txt, and .html files are supported' })

  const db = getDb(req.params.userId)
  const fileHash = crypto.createHash('sha256').update(req.file.buffer).digest('hex')
  const existing = db.prepare(`SELECT id, original_filename FROM dna_files WHERE file_hash = ?`).get(fileHash)
  if (existing) {
    return res.status(409).json({ error: `Duplicate: "${existing.original_filename}" was already uploaded` })
  }

  // Basename only in the DB -- the directory is derived from the user, so an
  // existing row stays valid under either layout.
  const storedFilename = `${fileHash}${ext}`
  const dnaDir = path.join(DATA_DIR, 'dna', req.params.userId)
  fs.mkdirSync(dnaDir, { recursive: true })
  fs.writeFileSync(path.join(dnaDir, storedFilename), req.file.buffer)

  const info = db.prepare(`
    INSERT INTO dna_files (filename, original_filename, file_hash)
    VALUES (?, ?, ?)
  `).run(storedFilename, req.file.originalname ?? storedFilename, fileHash)

  res.json(db.prepare(`SELECT * FROM dna_files WHERE id = ?`).get(info.lastInsertRowid))
})

app.get('/api/:userId/dna/files/:id/download', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const file = db.prepare(`SELECT * FROM dna_files WHERE id = ?`).get(req.params.id)
  if (!file) return res.status(404).json({ error: 'File not found' })

  const filePath = resolveDnaFilePath(req.params.userId, file.filename)
  if (!filePath) return res.status(404).json({ error: 'File missing from disk' })

  const downloadName = (file.original_filename || file.filename).replace(/[^\x20-\x7E]/g, '').replace(/"/g, '')
  const contentType = file.filename.endsWith('.txt') ? 'text/plain' : file.filename.endsWith('.html') ? 'text/html' : 'application/pdf'
  res.setHeader('Content-Type', contentType)
  res.setHeader('Content-Disposition', `attachment; filename="${downloadName}"`)
  fs.createReadStream(filePath).pipe(res)
})

app.delete('/api/:userId/dna/files/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const file = db.prepare(`SELECT * FROM dna_files WHERE id = ?`).get(req.params.id)
  if (!file) return res.status(404).json({ error: 'File not found' })

  db.transaction(() => {
    db.prepare(`UPDATE dna_traits SET file_id = NULL WHERE file_id = ?`).run(req.params.id)
    db.prepare(`DELETE FROM dna_files WHERE id = ?`).run(req.params.id)
  })()

  // Only remove bytes this profile exclusively owns: a file inside the user's
  // own directory that no other row in this database still points at. A legacy
  // flat file is left alone -- it may be any other profile's copy, and this DB
  // cannot see theirs. That leaks disk until the layout is fully migrated,
  // which is the safe direction for medical records.
  const filePath = resolveDnaFilePath(req.params.userId, file.filename)
  const userDir = path.resolve(path.join(DATA_DIR, 'dna', req.params.userId))
  const stillReferenced = db
    .prepare(`SELECT 1 FROM dna_files WHERE filename = ?`)
    .get(file.filename)

  let removed = false
  if (filePath && !stillReferenced && path.dirname(filePath) === userDir) {
    try {
      fs.unlinkSync(filePath)
      removed = true
    } catch (err) {
      console.error(`[dna] ${req.params.userId}: unlink ${file.filename} failed — ${err.message}`)
    }
  } else if (filePath && !removed) {
    console.log(`[dna] ${req.params.userId}: kept ${file.filename} on disk (legacy shared path or still referenced)`)
  }

  res.json({ ok: true, file_removed: removed })
})

// ─────────────────────────────────────────────────────────────
// Protocols
// ─────────────────────────────────────────────────────────────

app.get('/api/:userId/protocols', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  db.pragma('foreign_keys = ON')
  const protocols = db.prepare('SELECT * FROM protocols ORDER BY month ASC, sort_order ASC, id ASC').all()
  const subs = db.prepare('SELECT * FROM sub_protocols ORDER BY sort_order ASC, id ASC').all()
  const subsByProtocol = {}
  for (const s of subs) {
    if (!subsByProtocol[s.protocol_id]) subsByProtocol[s.protocol_id] = []
    subsByProtocol[s.protocol_id].push(s)
  }
  res.json(protocols.map(p => ({ ...p, sub_protocols: subsByProtocol[p.id] ?? [] })))
})

app.post('/api/:userId/protocols', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const { month, name, color = '#7c3aed' } = req.body
  if (!month || !name) return res.status(400).json({ error: 'month and name required' })
  const { lastInsertRowid } = db.prepare('INSERT INTO protocols (month, name, color) VALUES (?, ?, ?)').run(month, name, color)
  res.json({ ...db.prepare('SELECT * FROM protocols WHERE id = ?').get(lastInsertRowid), sub_protocols: [] })
})

app.patch('/api/:userId/protocols/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const p = db.prepare('SELECT * FROM protocols WHERE id = ?').get(req.params.id)
  if (!p) return res.status(404).json({ error: 'not found' })
  const { name = p.name, color = p.color } = req.body
  db.prepare('UPDATE protocols SET name = ?, color = ? WHERE id = ?').run(name, color, req.params.id)
  res.json(db.prepare('SELECT * FROM protocols WHERE id = ?').get(req.params.id))
})

app.delete('/api/:userId/protocols/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  db.pragma('foreign_keys = ON')
  db.prepare('DELETE FROM protocols WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

app.post('/api/:userId/protocols/:id/sub', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const { name } = req.body
  if (!name) return res.status(400).json({ error: 'name required' })
  const { lastInsertRowid } = db.prepare('INSERT INTO sub_protocols (protocol_id, name) VALUES (?, ?)').run(req.params.id, name)
  res.json(db.prepare('SELECT * FROM sub_protocols WHERE id = ?').get(lastInsertRowid))
})

app.patch('/api/:userId/sub-protocols/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const s = db.prepare('SELECT * FROM sub_protocols WHERE id = ?').get(req.params.id)
  if (!s) return res.status(404).json({ error: 'not found' })
  const { name = s.name } = req.body
  db.prepare('UPDATE sub_protocols SET name = ? WHERE id = ?').run(name, req.params.id)
  res.json(db.prepare('SELECT * FROM sub_protocols WHERE id = ?').get(req.params.id))
})

app.delete('/api/:userId/sub-protocols/:id', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  db.prepare('DELETE FROM sub_protocols WHERE id = ?').run(req.params.id)
  res.json({ ok: true })
})

app.post('/api/:userId/protocols/:id/copy-to-next', requireUser, (req, res) => {
  const db = getDb(req.params.userId)
  const src = db.prepare('SELECT * FROM protocols WHERE id = ?').get(req.params.id)
  if (!src) return res.status(404).json({ error: 'not found' })

  const [y, m] = src.month.split('-').map(Number)
  const d = new Date(y, m)
  const nextMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

  const subs = db.prepare('SELECT * FROM sub_protocols WHERE protocol_id = ?').all(src.id)

  const existing = db.prepare(
    "SELECT * FROM protocols WHERE month = ? AND LOWER(name) = LOWER(?)"
  ).get(nextMonth, src.name)

  if (existing) {
    const existingSubs = db.prepare('SELECT * FROM sub_protocols WHERE protocol_id = ?').all(existing.id)
    const existingNames = new Set(existingSubs.map(s => s.name.toLowerCase()))
    for (const sub of subs) {
      if (!existingNames.has(sub.name.toLowerCase())) {
        db.prepare('INSERT INTO sub_protocols (protocol_id, name) VALUES (?, ?)').run(existing.id, sub.name)
      }
    }
  } else {
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO protocols (month, name, color) VALUES (?, ?, ?)'
    ).run(nextMonth, src.name, src.color)
    for (const sub of subs) {
      db.prepare('INSERT INTO sub_protocols (protocol_id, name) VALUES (?, ?)').run(lastInsertRowid, sub.name)
    }
  }

  res.json({ ok: true, nextMonth })
})

// ─────────────────────────────────────────────────────────────
// SPA fallback
// ─────────────────────────────────────────────────────────────

// Unmatched /api/* paths must 404 as JSON. Falling through to the catch-all
// below answered them with index.html and a 200, so `res.json()` in
// client/src/api.js choked on the markup and every typo'd route or
// deleted-user call surfaced as `SyntaxError: Unexpected token '<'` instead of
// the actual status. app.use (not app.get) so non-GET verbs are covered too.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `No API route for ${req.method} ${req.originalUrl}` })
})

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'))
})

app.listen(PORT, () => {
  console.log(`Health Dashboard running on http://localhost:${PORT}`)

  // Archives and backups are never removed automatically (see db.js -> Retention).
  // Name them at startup so they cannot sit on the volume unnoticed.
  const retained = listRetainedArtifacts()
  if (retained.length) {
    const bytes = retained.reduce((n, r) => n + (r.bytes ?? 0), 0)
    console.log(`[retention] ${retained.length} archived artifact(s), ${(bytes / 1048576).toFixed(1)} MB — kept ${ARCHIVE_RETENTION_DAYS} days, then delete by hand`)
    for (const r of retained.filter(r => r.stale)) {
      console.log(`[retention] past ${ARCHIVE_RETENTION_DAYS} days (${r.ageDays}d): ${r.name}`)
    }
  }
})
