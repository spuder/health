/**
 * One-time migration: JSON seed files → SQLite metrics table
 *
 * Idempotent — safe to run multiple times (INSERT OR IGNORE).
 * Called automatically by docker-entrypoint.sh on first container start.
 */

import { readFileSync, existsSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { getDb, readUsers, DATA_DIR } from '../db.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function loadJSON(filename) {
  const p = path.join(DATA_DIR, filename)
  if (!existsSync(p)) return null
  return JSON.parse(readFileSync(p, 'utf8'))
}

const users = readUsers()
if (!users.length) {
  console.log('No users found — nothing to migrate. Create a user through the UI.')
  process.exit(0)
}

const targetUser = users[0]
console.log(`Migrating into ${targetUser.name}'s database (${targetUser.id}.db)…`)

const db = getDb(targetUser.id)

const insertMetric = db.prepare(`
  INSERT OR IGNORE INTO metrics (date, metric, value, source, notes)
  VALUES (@date, @metric, @value, @source, @notes)
`)

// ── Body ─────────────────────────────────────────────────────
const bodyData = loadJSON('body.json')
if (bodyData?.entries?.length) {
  const migrateBody = db.transaction((entries) => {
    for (const e of entries) {
      const base = { date: e.date, source: 'manual', notes: e.notes ?? null }
      if (e.weight               != null) insertMetric.run({ ...base, metric: 'weight',               value: e.weight })
      if (e.bmi                  != null) insertMetric.run({ ...base, metric: 'bmi',                  value: e.bmi })
      if (e.skeletal_muscle_mass != null) insertMetric.run({ ...base, metric: 'skeletal_muscle_mass', value: e.skeletal_muscle_mass })
      if (e.visceral_fat         != null) insertMetric.run({ ...base, metric: 'visceral_fat',          value: e.visceral_fat })
    }
  })
  migrateBody(bodyData.entries)
  console.log(`  ✓ Body: ${bodyData.entries.length} entries migrated`)
} else {
  console.log('  – body.json not found or empty, skipping')
}

// ── Blood ────────────────────────────────────────────────────
const bloodData = loadJSON('blood.json')
if (bloodData?.entries?.length) {
  const migrateBlood = db.transaction((entries) => {
    for (const e of entries) {
      const base = { date: e.date, source: 'manual', notes: e.notes ?? null }
      if (e.testosterone  != null) insertMetric.run({ ...base, metric: 'testosterone',  value: e.testosterone })
      if (e.triglycerides != null) insertMetric.run({ ...base, metric: 'triglycerides', value: e.triglycerides })
    }
  })
  migrateBlood(bloodData.entries)
  console.log(`  ✓ Blood: ${bloodData.entries.length} entries migrated`)
} else {
  console.log('  – blood.json not found or empty, skipping')
}

// ── Events ───────────────────────────────────────────────────
const eventsData = loadJSON('events.json')
if (eventsData?.entries?.length) {
  const insertEvent = db.prepare(`
    INSERT OR IGNORE INTO events (date, type, label, notes)
    VALUES (@date, @type, @label, @notes)
  `)
  const migrateEvents = db.transaction((entries) => {
    for (const e of entries) {
      insertEvent.run({ date: e.date, type: e.type, label: e.label, notes: e.notes ?? null })
    }
  })
  migrateEvents(eventsData.entries)
  console.log(`  ✓ Events: ${eventsData.entries.length} entries migrated`)
} else {
  console.log('  – events.json not found or empty, skipping')
}

console.log(`\nDone. Open data/${targetUser.id}.db to verify.`)
