import 'dotenv/config'
import express from 'express'
import cors from 'cors'
import path from 'path'
import { fileURLToPath } from 'url'
import multer from 'multer'
import Anthropic from '@anthropic-ai/sdk'
import { PDFParse } from 'pdf-parse'
import { getDb, readUsers, writeUsers, DATA_DIR } from './db.js'

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
    byDate[row.date][row.metric] = row.value
    byDate[row.date].source = row.source
    byDate[row.date].notes  = row.notes
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date))
}

// ─────────────────────────────────────────────────────────────
// Users
// ─────────────────────────────────────────────────────────────

app.get('/api/users', (req, res) => {
  res.json(readUsers())
})

app.post('/api/users', (req, res) => {
  const { name, color, initials, height_inches } = req.body
  if (!name) return res.status(400).json({ error: 'name is required' })

  const id = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '')
  const users = readUsers()

  if (users.find(u => u.id === id)) {
    return res.status(409).json({ error: `User '${id}' already exists` })
  }

  const user = {
    id,
    name,
    color:         color         || '#7c3aed',
    initials:      initials      || name.slice(0, 2).toUpperCase(),
    height_inches: height_inches || null,
  }
  users.push(user)
  writeUsers(users)
  getDb(id)  // init DB immediately

  res.json({ ok: true, user })
})

app.delete('/api/users/:userId', requireUser, (req, res) => {
  const users = readUsers().filter(u => u.id !== req.params.userId)
  writeUsers(users)
  res.json({ ok: true })
})

// ─────────────────────────────────────────────────────────────
// Body  (metrics: weight, bmi, skeletal_muscle_mass, visceral_fat)
// ─────────────────────────────────────────────────────────────

const BODY_METRICS = [
  'weight', 'bmi', 'skeletal_muscle_mass', 'body_fat_mass', 'body_fat',
  'lean_mass', 'visceral_fat', 'bmr', 'total_body_water',
]

const EXERCISE_METRICS = ['exercise_minutes', 'workout_count', 'hr_hard_minutes']

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

  res.json({ height_inches: req.user.height_inches, entries: pivotMetrics(rows) })
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
    if (weight               != null) upsert.run({ ...base, metric: 'weight',               value: weight })
    if (bmi                  != null) upsert.run({ ...base, metric: 'bmi',                  value: bmi })
    if (skeletal_muscle_mass != null) upsert.run({ ...base, metric: 'skeletal_muscle_mass', value: skeletal_muscle_mass })
    if (visceral_fat         != null) upsert.run({ ...base, metric: 'visceral_fat',          value: visceral_fat })
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

const SLEEP_METRICS = ['sleep_hours', 'sleep_quality', 'deep_sleep_hours', 'rem_sleep_hours']

// Ranges calibrated against Rythm Health's Optimal/Average/Out-of-Range classifications.
// range_low/high = outer boundary (Average zone). optimal_low/high = inner target (Optimal zone).
const BLOOD_MARKERS = {
  // Hormones — Rythm Health uses optimization targets, not standard lab population ranges
  testosterone:               { unit: 'ng/dL',    range_low: 300,  range_high: 1000, optimal_low: 500,  optimal_high: 900  },
  total_testosterone:         { unit: 'ng/dL',    range_low: 300,  range_high: 1000, optimal_low: 500,  optimal_high: 900  },
  free_testosterone:          { unit: 'pg/mL',    range_low: 46,   range_high: 224,  optimal_low: 120,  optimal_high: 180  },
  estrogen:                   { unit: 'pg/mL',    range_low: 10,   range_high: 50,   optimal_low: 20,   optimal_high: 40   },
  estradiol:                  { unit: 'pg/mL',    range_low: 10,   range_high: 50,   optimal_low: 20,   optimal_high: 40   },
  shbg:                       { unit: 'nmol/L',   range_low: 10,   range_high: 57,   optimal_low: 20,   optimal_high: 40   },
  dhea_s:                     { unit: 'µg/dL',    range_low: 80,   range_high: 560,  optimal_low: 200,  optimal_high: 450  },
  cortisol:                   { unit: 'µg/dL',    range_low: 6,    range_high: 23,   optimal_low: 10,   optimal_high: 18   },
  igf1:                       { unit: 'ng/mL',    range_low: 100,  range_high: 303,  optimal_low: 150,  optimal_high: 250  },
  psa:                        { unit: 'ng/mL',    range_low: 0,    range_high: 4,    optimal_low: 0,    optimal_high: 2.5  },
  // Thyroid
  tsh:                        { unit: 'uIU/mL',   range_low: 0.4,  range_high: 4.0,  optimal_low: 1.0,  optimal_high: 2.5  },
  free_t3:                    { unit: 'pg/mL',    range_low: 2.0,  range_high: 4.4,  optimal_low: 3.0,  optimal_high: 4.0  },
  free_t4:                    { unit: 'ng/dL',    range_low: 0.8,  range_high: 1.8,  optimal_low: 1.1,  optimal_high: 1.5  },
  // Lipids — Rythm Health uses stricter optimal targets than standard labs
  total_cholesterol:          { unit: 'mg/dL',    range_low: 0,    range_high: 200,  optimal_low: 0,    optimal_high: 150  },
  ldl:                        { unit: 'mg/dL',    range_low: 0,    range_high: 120,  optimal_low: 0,    optimal_high: 80   },
  hdl:                        { unit: 'mg/dL',    range_low: 40,   range_high: 100,  optimal_low: 60,   optimal_high: 100  },
  triglycerides:              { unit: 'mg/dL',    range_low: 0,    range_high: 150,  optimal_low: 0,    optimal_high: 100  },
  apob:                       { unit: 'mg/dL',    range_low: 0,    range_high: 90,   optimal_low: 0,    optimal_high: 70   },
  remnant_cholesterol:        { unit: 'mg/dL',    range_low: 0,    range_high: 30,   optimal_low: 0,    optimal_high: 18   },
  triglycerides_hdl_ratio:    { unit: '',         range_low: 0,    range_high: 2.0,  optimal_low: 0,    optimal_high: 1.5  },
  total_cholesterol_hdl_ratio:{ unit: '',         range_low: 0,    range_high: 3.5,  optimal_low: 0,    optimal_high: 3.0  },
  ldl_apob_ratio:             { unit: '',         range_low: 1.0,  range_high: null, optimal_low: 1.2,  optimal_high: null },
  // Blood sugar
  glucose:                    { unit: 'mg/dL',    range_low: 70,   range_high: 99,   optimal_low: 75,   optimal_high: 90   },
  hba1c:                      { unit: '%',        range_low: 0,    range_high: 5.7,  optimal_low: 0,    optimal_high: 5.2  },
  fructosamine:               { unit: 'umol/L',   range_low: 200,  range_high: 285,  optimal_low: 200,  optimal_high: 270  },
  // Vitamins & minerals
  vitamin_d:                  { unit: 'ng/mL',    range_low: 30,   range_high: 100,  optimal_low: 50,   optimal_high: 80   },
  vitamin_b12:                { unit: 'pg/mL',    range_low: 200,  range_high: 900,  optimal_low: 400,  optimal_high: 900  },
  ferritin:                   { unit: 'ng/mL',    range_low: 30,   range_high: 300,  optimal_low: 100,  optimal_high: 200  },
  iron:                       { unit: 'µg/dL',    range_low: 60,   range_high: 170,  optimal_low: 80,   optimal_high: 130  },
  magnesium:                  { unit: 'mg/dL',    range_low: 1.7,  range_high: 2.2,  optimal_low: 1.9,  optimal_high: 2.1  },
  calcium:                    { unit: 'mg/dL',    range_low: 8.5,  range_high: 10.5, optimal_low: 9.0,  optimal_high: 10.0 },
  // Inflammation
  crp:                        { unit: 'mg/L',     range_low: 0,    range_high: 3.0,  optimal_low: 0,    optimal_high: 1.0  },
  hscrp:                      { unit: 'mg/L',     range_low: 0,    range_high: 1.0,  optimal_low: 0,    optimal_high: 0.5  },
  homocysteine:               { unit: 'µmol/L',   range_low: 0,    range_high: 15,   optimal_low: 0,    optimal_high: 9    },
  // CBC
  white_blood_cells:          { unit: '×10³/µL',  range_low: 4.5,  range_high: 11.0, optimal_low: 5.0,  optimal_high: 7.0  },
  red_blood_cells:            { unit: '×10⁶/µL',  range_low: 4.5,  range_high: 5.9,  optimal_low: 4.7,  optimal_high: 5.5  },
  hemoglobin:                 { unit: 'g/dL',     range_low: 13.5, range_high: 17.5, optimal_low: 14.5, optimal_high: 17.0 },
  hematocrit:                 { unit: '%',        range_low: 41,   range_high: 53,   optimal_low: 43,   optimal_high: 50   },
  platelets:                  { unit: '×10³/µL',  range_low: 150,  range_high: 400,  optimal_low: 150,  optimal_high: 350  },
  neutrophils:                { unit: '%',        range_low: 40,   range_high: 70,   optimal_low: 50,   optimal_high: 65   },
  lymphocytes:                { unit: '%',        range_low: 20,   range_high: 40,   optimal_low: 25,   optimal_high: 38   },
  monocytes:                  { unit: '%',        range_low: 2,    range_high: 10,   optimal_low: 3,    optimal_high: 8    },
  eosinophils:                { unit: '%',        range_low: 0,    range_high: 6,    optimal_low: 0,    optimal_high: 4    },
  basophils:                  { unit: '%',        range_low: 0,    range_high: 2,    optimal_low: 0,    optimal_high: 1    },
  // Metabolic panel
  sodium:                     { unit: 'mEq/L',    range_low: 136,  range_high: 145,  optimal_low: 138,  optimal_high: 142  },
  potassium:                  { unit: 'mEq/L',    range_low: 3.5,  range_high: 5.1,  optimal_low: 4.0,  optimal_high: 4.5  },
  creatinine:                 { unit: 'mg/dL',    range_low: 0.6,  range_high: 1.1,  optimal_low: 0.7,  optimal_high: 1.0  },
  egfr:                       { unit: 'mL/min',   range_low: 60,   range_high: 120,  optimal_low: 90,   optimal_high: 120  },
  bun:                        { unit: 'mg/dL',    range_low: 7,    range_high: 20,   optimal_low: 10,   optimal_high: 18   },
  uric_acid:                  { unit: 'mg/dL',    range_low: 3.5,  range_high: 7.0,  optimal_low: 3.5,  optimal_high: 6.0  },
  albumin:                    { unit: 'g/dL',     range_low: 3.5,  range_high: 5.0,  optimal_low: 4.0,  optimal_high: 5.0  },
  total_protein:              { unit: 'g/dL',     range_low: 6.0,  range_high: 8.3,  optimal_low: 6.5,  optimal_high: 8.0  },
  globulin:                   { unit: 'g/dL',     range_low: 1.5,  range_high: 3.5,  optimal_low: 2.0,  optimal_high: 3.0  },
  // Liver
  alt:                        { unit: 'U/L',      range_low: 7,    range_high: 56,   optimal_low: 7,    optimal_high: 30   },
  ast:                        { unit: 'U/L',      range_low: 10,   range_high: 40,   optimal_low: 10,   optimal_high: 25   },
  ggt:                        { unit: 'U/L',      range_low: 8,    range_high: 40,   optimal_low: 8,    optimal_high: 25   },
  alkaline_phosphatase:       { unit: 'U/L',      range_low: 30,   range_high: 120,  optimal_low: 40,   optimal_high: 80   },
  total_bilirubin:            { unit: 'mg/dL',    range_low: 0.2,  range_high: 1.2,  optimal_low: 0.2,  optimal_high: 0.8  },
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
    if (cfg.range_low  != null) markers[cfg.metric].range_low  = cfg.range_low
    if (cfg.range_high != null) markers[cfg.metric].range_high = cfg.range_high
    if (cfg.unit)               markers[cfg.metric].unit       = cfg.unit
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
    if (testosterone  != null) upsert.run({ ...base, metric: 'testosterone',  value: testosterone })
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

  res.json({ entries: pivotMetrics(rows) })
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
    if (sleep_hours      != null) upsert.run({ ...base, metric: 'sleep_hours',      value: sleep_hours })
    if (sleep_quality    != null) upsert.run({ ...base, metric: 'sleep_quality',    value: sleep_quality })
    if (deep_sleep_hours != null) upsert.run({ ...base, metric: 'deep_sleep_hours', value: deep_sleep_hours })
    if (rem_sleep_hours  != null) upsert.run({ ...base, metric: 'rem_sleep_hours',  value: rem_sleep_hours })
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
  body_mass:                        'weight',
  body_fat_percentage:              'body_fat',
  lean_body_mass:                   'lean_mass',
  body_mass_index:                  'bmi',
  // Heart
  heart_rate:                       'heart_rate',
  resting_heart_rate:               'resting_heart_rate',
  heart_rate_variability_sdnn:      'hrv',
  heart_rate_variability:           'hrv',
  // Activity
  apple_exercise_time:              'exercise_minutes',
  active_energy_burned:             'active_calories',
  active_energy:                    'active_calories',
  basal_energy_burned:              'resting_calories',
  step_count:                       'steps',
  walking_running_distance:         'distance_miles',
  physical_effort:                  'physical_effort',
  // Other vitals
  vo2_max:                          'vo2_max',
  blood_glucose:                    'blood_glucose',
  blood_pressure_systolic:          'bp_systolic',
  blood_pressure_diastolic:         'bp_diastolic',
  blood_oxygen_saturation:          'blood_oxygen',
  respiratory_rate:                 'respiratory_rate',
  body_temperature:                 'body_temp_f',
  apple_sleeping_wrist_temperature: 'wrist_temp_c',
  // Sleep
  sleep_analysis:                   'sleep_hours',
}

function convertUnit(haeMetricName, qty, units) {
  if (haeMetricName === 'body_mass' && units === 'kg') return Math.round(qty * 2.20462 * 10) / 10
  return Math.round(qty * 10) / 10
}

app.post('/api/:userId/import/apple-health', requireUser, (req, res) => {
  const db      = getDb(req.params.userId)
  const metrics = req.body?.data?.metrics ?? []
  const stats   = { imported: 0, skipped: 0 }

  const upsert = db.prepare(`
    INSERT INTO metrics (date, metric, value, source)
    VALUES (@date, @metric, @value, @source)
    ON CONFLICT(date, metric, source) DO UPDATE SET value = excluded.value
  `)

  const workouts = req.body?.data?.workouts ?? []

  const importAll = db.transaction(() => {
    for (const { name, units, data = [] } of metrics) {
      const metricName = HAE_METRIC_MAP[name] || name

      for (const point of data) {
        const date = point.date?.slice(0, 10)
        if (!date) { stats.skipped++; continue }

        const raw = parseFloat(point.qty)
        if (isNaN(raw)) { stats.skipped++; continue }

        const value = convertUnit(name, raw, units)
        upsert.run({ date, metric: metricName, value, source: 'apple_health' })
        stats.imported++
      }
    }

    // Aggregate workouts → workout_count + exercise_minutes per day
    if (workouts.length) {
      const byDate = {}
      for (const w of workouts) {
        const date = w.start?.slice(0, 10)
        if (!date) continue
        if (!byDate[date]) byDate[date] = { count: 0, minutes: 0 }
        byDate[date].count++
        byDate[date].minutes += w.duration ?? 0
      }
      for (const [date, { count, minutes }] of Object.entries(byDate)) {
        upsert.run({ date, metric: 'workout_count',    value: count,               source: 'apple_health' })
        upsert.run({ date, metric: 'exercise_minutes', value: Math.round(minutes), source: 'apple_health' })
        stats.imported += 2
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
// Exercise  (metrics: exercise_minutes, workout_count, hr_hard_minutes)
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
    upsert.run({ ...base, metric: 'workout_count',    value: 1 })
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

const LAB_SYSTEM_PROMPT = `You are a health data parser. Extract every health metric AND reference range from the report text provided.

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

app.post('/api/:userId/import/labs-pdf', requireUser, upload.single('pdf'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded' })

  // ── 1. Extract text ───────────────────────────────────────
  let text
  try {
    const parser = new PDFParse({ data: req.file.buffer })
    const result = await parser.getText()
    text = result.text?.trim()
  } catch (err) {
    console.error('[labs-pdf] pdf-parse error:', err)
    return res.status(422).json({ error: `Could not extract PDF text: ${err.message}` })
  }

  if (!text) {
    return res.status(422).json({ error: 'No selectable text found in PDF. Scanned/image-only PDFs are not supported.' })
  }

  console.log('[labs-pdf] Extracted text (first 2000 chars):\n', text.slice(0, 2000))

  // ── 2. Parse with Claude ──────────────────────────────────
  let parsed
  try {
    const msg = await anthropic.messages.create({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: LAB_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    })

    const raw = msg.content[0].text.trim()
    const jsonStr = raw.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '')
    parsed = JSON.parse(jsonStr)
    console.log('[labs-pdf] Claude extracted:', JSON.stringify(parsed, null, 2))
  } catch (err) {
    console.error('[labs-pdf] Claude parse error:', err)
    return res.status(500).json({ error: `AI parsing failed: ${err.message}` })
  }

  const { date, metrics } = parsed
  const validMetrics = Object.entries(metrics ?? {})
    .filter(([, v]) => v != null && !isNaN(Number(v)))

  if (!validMetrics.length) {
    return res.status(422).json({ error: 'No numeric metrics found in this PDF.' })
  }

  // ── 3. Upsert into DB ─────────────────────────────────────
  const db = getDb(req.params.userId)
  const upsert = db.prepare(`
    INSERT INTO metrics (date, metric, value, source, notes)
    VALUES (@date, @metric, @value, @source, @notes)
    ON CONFLICT(date, metric, source) DO UPDATE SET
      value = excluded.value,
      notes = excluded.notes
  `)

  const rangeUpsert = db.prepare(`
    INSERT INTO marker_configs (metric, range_low, range_high, source, updated_at)
    VALUES (@metric, @range_low, @range_high, 'pdf_import', datetime('now'))
    ON CONFLICT(metric) DO UPDATE SET
      range_low  = COALESCE(excluded.range_low,  range_low),
      range_high = COALESCE(excluded.range_high, range_high),
      source     = 'pdf_import',
      updated_at = excluded.updated_at
  `)

  try {
    db.transaction(() => {
      for (const [metric, value] of validMetrics) {
        upsert.run({ date, metric, value: Number(value), source: 'pdf_import', notes: null })
      }

      const ranges = parsed.reference_ranges ?? {}
      for (const [metric, { low, high }] of Object.entries(ranges)) {
        if (low == null && high == null) continue
        rangeUpsert.run({ metric, range_low: low ?? null, range_high: high ?? null })
      }
    })()
    const rangeCount = Object.keys(parsed.reference_ranges ?? {}).length
    console.log(`[labs-pdf] Saved ${validMetrics.length} metrics, ${rangeCount} reference ranges to ${req.params.userId}.db (date: ${date})`)
  } catch (err) {
    console.error('[labs-pdf] DB write error:', err)
    return res.status(500).json({ error: `Database write failed: ${err.message}` })
  }

  res.json({
    ok: true,
    date,
    source_type: parsed.source_type ?? 'other',
    markers_found: validMetrics.map(([k]) => k),
    count: validMetrics.length,
  })
})

// ─────────────────────────────────────────────────────────────
// SPA fallback
// ─────────────────────────────────────────────────────────────

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'client/dist/index.html'))
})

app.listen(PORT, () => {
  console.log(`Health Dashboard running on http://localhost:${PORT}`)
})
