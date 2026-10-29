import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { useTempDataDir, seed } from './helpers.js'

useTempDataDir()
const { getDb } = await import('../db.js')
const V = await import('../views.js')
const Q = await import('../metrics-query.js')

let db
before(() => {
  db = getDb('views-test')
  seed(db, [
    ['2026-01-01', 'resting_heart_rate', 60, 'apple_health'],
    ['2026-01-01', 'resting_heart_rate', 50, 'oura'],
    ['2026-01-02', 'resting_heart_rate', 58, 'apple_health'],
    ['2026-01-03', 'resting_heart_rate', 56, 'apple_health'],
    ['2026-01-02', 'weight', 180],
  ])
})

test('addView derives slug, defaults, and position', () => {
  const a = V.addView(db, { title: 'Resting HR', metrics: ['resting_heart_rate'] })
  assert.equal(a.slug, 'resting-hr')
  assert.equal(a.chart, 'line')
  assert.equal(a.aggregate, 'last')
  assert.equal(a.starred, true)
  assert.equal(a.created_by, 'user')
  assert.deepEqual(a.metrics, ['resting_heart_rate'])
  const b = V.addView(db, { title: 'Weight', metrics: 'weight', chart: 'number', created_by: 'agent' })
  assert.equal(b.position, a.position + 1)
  assert.equal(b.created_by, 'agent')
  assert.deepEqual(V.listViews(db).map(v => v.slug), ['resting-hr', 'weight'])
})

test('addView validates input', () => {
  assert.throws(() => V.addView(db, { metrics: ['weight'] }), /title is required/)
  assert.throws(() => V.addView(db, { title: 'x', metrics: [] }), /non-empty/)
  assert.throws(() => V.addView(db, { title: 'x', metrics: ['Bad Key'] }), /invalid metric key/)
  assert.throws(() => V.addView(db, { title: 'x', metrics: ['weight'], chart: 'pie' }), /chart must be/)
  assert.throws(() => V.addView(db, { title: 'x', metrics: ['weight'], range_days: -1 }), /range_days/)
  assert.throws(() => V.addView(db, { title: 'Resting HR', metrics: ['weight'] }), e => e.status === 409)
  assert.throws(() => V.addView(db, { title: '123', metrics: ['weight'] }), /numeric/)
})

test('getView by id or slug; updateView patches and star toggles', () => {
  const v = V.getView(db, 'weight')
  assert.equal(V.getView(db, v.id).slug, 'weight')
  assert.equal(V.getView(db, String(v.id)).slug, 'weight')
  const u = V.updateView(db, 'weight', { starred: false, range_days: 30, title: 'Body weight', created_by: 'user' })
  assert.equal(u.starred, false)
  assert.equal(u.range_days, 30)
  assert.equal(u.title, 'Body weight')
  assert.equal(u.slug, 'weight', 'slug is stable across renames')
  assert.equal(u.created_by, 'agent', 'provenance is immutable')
  assert.deepEqual(V.listViews(db, { starredOnly: true }).map(v => v.slug), ['resting-hr'])
  assert.throws(() => V.updateView(db, 'nope', { starred: true }), e => e.status === 404)
})

test('removeView deletes and returns the view, metrics untouched', () => {
  const removed = V.removeView(db, 'weight')
  assert.equal(removed.slug, 'weight')
  assert.equal(V.getView(db, 'weight'), null)
  assert.throws(() => V.removeView(db, 'weight'), e => e.status === 404)
  assert.equal(Q.listMetrics(db).find(m => m.metric === 'weight').count, 1)
})

test('listMetrics reports counts, span, sources and latest', () => {
  const rhr = Q.listMetrics(db).find(m => m.metric === 'resting_heart_rate')
  assert.equal(rhr.count, 4)
  assert.equal(rhr.days, 3)
  assert.equal(rhr.first_date, '2026-01-01')
  assert.equal(rhr.last_date, '2026-01-03')
  assert.equal(rhr.latest_value, 56)
  assert.deepEqual(rhr.sources.sort(), ['apple_health', 'oura'])
  assert.deepEqual(Q.listMetrics(db, { search: 'WEI' }).map(m => m.metric), ['weight'])
})

test('queryMetrics aggregates sources per day and filters', () => {
  const last = Q.queryMetrics(db, ['resting_heart_rate'])
  assert.deepEqual(last.series.resting_heart_rate.map(p => p.value), [50, 58, 56])
  const avg = Q.queryMetrics(db, 'resting_heart_rate', { aggregate: 'avg' })
  assert.equal(avg.series.resting_heart_rate[0].value, 55)
  assert.deepEqual(avg.series.resting_heart_rate[0].sources, ['apple_health', 'oura'])
  const ranged = Q.queryMetrics(db, ['resting_heart_rate'], { from: '2026-01-02', to: '2026-01-02' })
  assert.deepEqual(ranged.series.resting_heart_rate.map(p => p.date), ['2026-01-02'])
  const src = Q.queryMetrics(db, ['resting_heart_rate'], { source: 'oura' })
  assert.equal(src.series.resting_heart_rate.length, 1)
  const lim = Q.queryMetrics(db, ['resting_heart_rate'], { limit: 1 })
  assert.deepEqual(lim.series.resting_heart_rate.map(p => p.date), ['2026-01-03'])
  assert.throws(() => Q.queryMetrics(db, []), /at least one/)
  assert.throws(() => Q.queryMetrics(db, ['weight'], { from: '1/1/2026' }), /YYYY-MM-DD/)
  assert.throws(() => Q.queryMetrics(db, ['weight'], { aggregate: 'median' }), /aggregate/)
})

test('summarizeSeries and getViewData', () => {
  const s = Q.summarizeSeries(Q.queryMetrics(db, ['resting_heart_rate']).series.resting_heart_rate)
  assert.equal(s.min, 50); assert.equal(s.max, 58); assert.equal(s.last.value, 56)
  assert.deepEqual(Q.summarizeSeries([]), { count: 0 })
  const d = Q.getViewData(db, 'resting-hr')
  assert.equal(d.view.slug, 'resting-hr')
  assert.equal(d.series.resting_heart_rate.length, 3)
  assert.throws(() => Q.getViewData(db, 'missing'), e => e.status === 404)
})
