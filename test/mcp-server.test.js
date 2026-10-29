import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { useTempDataDir, seed } from './helpers.js'

// End to end: spawn the real stdio server, as an MCP client would.
const dataDir = useTempDataDir()
const { getDb, writeUsers } = await import('../db.js')
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')

let client
const call = async (name, args = {}) => {
  const r = await client.callTool({ name, arguments: args })
  return { ...r, data: r.isError ? null : JSON.parse(r.content[0].text), text: r.content[0].text }
}

before(async () => {
  writeUsers([{ id: 'alice', name: 'Alice' }, { id: 'bob', name: 'Bob' }])
  seed(getDb('alice'), [
    ['2026-03-01', 'running_pace', 9.5, 'apple_health'],
    ['2026-03-05', 'running_pace', 9.1, 'apple_health'],
    ['2026-03-05', 'weight', 170, 'manual'],
  ])
  client = new Client({ name: 'test', version: '0.0.0' })
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [path.join(root, 'mcp-server.js')],
    cwd: root,
    env: { ...process.env, DATA_DIR: dataDir, HEALTH_USER_ID: '' },
    stderr: 'ignore',
  }))
})

after(async () => {
  await client?.close()
  fs.rmSync(dataDir, { recursive: true, force: true })
})

test('advertises the expected tools', async () => {
  const { tools } = await client.listTools()
  assert.deepEqual(tools.map(t => t.name).sort(), [
    'add_view', 'get_view_data', 'list_metrics', 'list_users', 'list_views',
    'query_metrics', 'remove_view', 'update_view',
  ])
  assert.equal(tools.find(t => t.name === 'remove_view').annotations.destructiveHint, true)
})

test('list_users and user resolution', async () => {
  assert.deepEqual((await call('list_users')).data.map(u => u.id), ['alice', 'bob'])
  const r = await call('list_metrics')
  assert.equal(r.isError, true)
  assert.match(r.text, /user_id is required/)
  assert.match((await call('list_metrics', { user_id: 'carol' })).text, /not found/)
})

test('list_metrics and query_metrics', async () => {
  const metrics = (await call('list_metrics', { user_id: 'alice' })).data
  assert.deepEqual(metrics.map(m => m.metric), ['running_pace', 'weight'])
  const q = (await call('query_metrics', { user_id: 'alice', metrics: ['running_pace'] })).data
  assert.deepEqual(q.series.running_pace.map(p => p.value), [9.5, 9.1])
  assert.equal(q.summary.running_pace.min, 9.1)
  const s = (await call('query_metrics', { user_id: 'alice', metrics: ['running_pace'], summary_only: true })).data
  assert.equal(s.series, undefined)
  assert.equal(s.summary.running_pace.count, 2)
})

test('add, list, get data, update, remove a view', async () => {
  const added = (await call('add_view', { user_id: 'alice', title: 'Outdoor run pace', metrics: ['running_pace'], range_days: 90 })).data
  assert.equal(added.slug, 'outdoor-run-pace')
  assert.equal(added.created_by, 'agent')

  const views = (await call('list_views', { user_id: 'alice' })).data
  assert.deepEqual(views.map(v => v.slug), ['outdoor-run-pace'])
  assert.deepEqual((await call('list_views', { user_id: 'bob' })).data, [], 'views are per profile')

  const data = (await call('get_view_data', { user_id: 'alice', view: 'outdoor-run-pace', days: 3650 })).data
  assert.equal(data.series.running_pace.length, 2)

  const hidden = (await call('update_view', { user_id: 'alice', view: added.id, starred: false })).data
  assert.equal(hidden.starred, false)
  assert.deepEqual((await call('list_views', { user_id: 'alice', starred_only: true })).data, [])

  const removed = await call('remove_view', { user_id: 'alice', view: 'outdoor-run-pace' })
  assert.equal(removed.data.removed.slug, 'outdoor-run-pace')
  assert.match((await call('remove_view', { user_id: 'alice', view: 'outdoor-run-pace' })).text, /not found/)
})

test('add_view rejects unknown metrics unless allowed, and duplicate slugs', async () => {
  const r = await call('add_view', { user_id: 'alice', title: 'VO2', metrics: ['vo2_max'] })
  assert.equal(r.isError, true)
  assert.match(r.text, /no data for metric/)
  const ok = await call('add_view', { user_id: 'alice', title: 'VO2', metrics: ['vo2_max'], allow_unknown_metrics: true })
  assert.equal(ok.isError, undefined)
  const dup = await call('add_view', { user_id: 'alice', title: 'VO2', metrics: ['weight'] })
  assert.match(dup.text, /already exists/)
})
