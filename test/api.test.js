import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { useTempDataDir } from './helpers.js'

// Boots the real Express server against a temp DATA_DIR and drives the views
// REST endpoints the dashboard UI uses.
const dataDir = useTempDataDir()
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 3900 + Math.floor(Math.random() * 90)
const base = `http://127.0.0.1:${PORT}/api`
let proc

const req = async (method, p, body) => {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) })
  return { status: r.status, body: await r.json() }
}

before(async () => {
  proc = spawn(process.execPath, ['server.js'], {
    cwd: root, stdio: 'ignore',
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(PORT), ANTHROPIC_API_KEY: 'test-placeholder' },
  })
  for (let i = 0; i < 50; i++) {
    try { await fetch(`${base}/users`); return } catch { await new Promise(r => setTimeout(r, 100)) }
  }
  throw new Error('server did not start')
})

after(() => {
  proc?.kill()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('views REST lifecycle', async () => {
  assert.equal((await req('POST', '/users', { name: 'Dana' })).status, 200)
  await req('POST', '/dana/body', { date: '2026-02-01', weight: 150 })

  const metrics = await req('GET', '/dana/metrics')
  assert.ok(metrics.body.some(m => m.metric === 'weight'))
  const q = await req('GET', '/dana/metrics/query?metric=weight')
  assert.equal(q.body.series.weight[0].value, 150)
  assert.equal((await req('GET', '/dana/metrics/query?metric=weight&from=bad')).status, 400)

  const created = await req('POST', '/dana/views', { title: 'Weight trend', metrics: ['weight'] })
  assert.equal(created.status, 201)
  assert.equal((await req('POST', '/dana/views', { title: 'Weight trend', metrics: ['weight'] })).status, 409)
  assert.equal((await req('POST', '/dana/views', { title: '' })).status, 400)

  assert.equal((await req('GET', '/dana/views')).body.length, 1)
  assert.equal((await req('GET', '/dana/views/weight-trend')).body.id, created.body.id)
  assert.equal((await req('GET', '/dana/views/weight-trend/data')).body.series.weight.length, 1)
  assert.equal((await req('PATCH', '/dana/views/weight-trend', { starred: false })).body.starred, false)
  assert.equal((await req('GET', '/dana/views?starred=1')).body.length, 0)
  assert.equal((await req('DELETE', '/dana/views/weight-trend')).body.ok, true)
  assert.equal((await req('DELETE', '/dana/views/weight-trend')).status, 404)
  assert.equal((await req('GET', '/nobody/views')).status, 404)
})
