import fs from 'fs'
import os from 'os'
import path from 'path'

// db.js reads DATA_DIR at import time, so every test file points it at a
// throwaway directory before importing anything that touches the database.
export function useTempDataDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'health-test-'))
  process.env.DATA_DIR = dir
  return dir
}

export function seed(db, rows) {
  const ins = db.prepare(`INSERT INTO metrics (date, metric, value, source) VALUES (?, ?, ?, ?)`)
  for (const [date, metric, value, source = 'manual'] of rows) ins.run(date, metric, value, source)
}
