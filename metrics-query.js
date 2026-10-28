// Read-only queries over the EAV `metrics` table, shared by the REST API and
// the MCP server. Plain functions over a better-sqlite3 handle.

import { AGGREGATES, getView, ViewError } from './views.js'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function localDateDaysAgo(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Every metric key with how much data it has and its most recent value.
export function listMetrics(db, { search } = {}) {
  const rows = db.prepare(`
    SELECT metric,
           COUNT(*)              AS count,
           COUNT(DISTINCT date)  AS days,
           MIN(date)             AS first_date,
           MAX(date)             AS last_date,
           GROUP_CONCAT(DISTINCT source) AS sources
    FROM metrics
    ${search ? 'WHERE metric LIKE @like' : ''}
    GROUP BY metric
    ORDER BY metric
  `).all(search ? { like: `%${String(search).toLowerCase()}%` } : {})
  const latest = db.prepare(`SELECT value FROM metrics WHERE metric = ? ORDER BY date DESC, id DESC LIMIT 1`)
  return rows.map(r => ({
    metric: r.metric,
    count: r.count,
    days: r.days,
    first_date: r.first_date,
    last_date: r.last_date,
    latest_value: latest.get(r.metric)?.value ?? null,
    sources: r.sources ? r.sources.split(',') : [],
  }))
}

function collapse(values, aggregate) {
  switch (aggregate) {
    case 'avg': return values.reduce((a, b) => a + b, 0) / values.length
    case 'sum': return values.reduce((a, b) => a + b, 0)
    case 'min': return Math.min(...values)
    case 'max': return Math.max(...values)
    default:    return values[values.length - 1]  // 'last': rows arrive ordered by id
  }
}

/**
 * Daily series for one or more metrics.
 * opts: { from, to, days, source, aggregate = 'last', limit, raw }
 * Returns { metrics, from, to, aggregate, series: { <metric>: [{date, value, sources}] }, rows? }
 */
export function queryMetrics(db, metrics, opts = {}) {
  const list = (Array.isArray(metrics) ? metrics : [metrics]).filter(Boolean)
  if (!list.length) throw new ViewError('at least one metric is required')
  const aggregate = opts.aggregate ?? 'last'
  if (!AGGREGATES.includes(aggregate)) throw new ViewError(`aggregate must be one of: ${AGGREGATES.join(', ')}`)

  let { from, to } = opts
  if (opts.days != null) {
    if (!(Number.isInteger(opts.days) && opts.days > 0)) throw new ViewError('days must be a positive integer')
    from = from ?? localDateDaysAgo(opts.days)
  }
  for (const [k, v] of [['from', from], ['to', to]]) {
    if (v != null && !DATE_RE.test(v)) throw new ViewError(`${k} must be YYYY-MM-DD`)
  }

  const where = [`metric IN (${list.map(() => '?').join(',')})`]
  const params = [...list]
  if (from)        { where.push('date >= ?');  params.push(from) }
  if (to)          { where.push('date <= ?');  params.push(to) }
  if (opts.source) { where.push('source = ?'); params.push(opts.source) }

  const rows = db.prepare(`
    SELECT id, date, metric, value, source FROM metrics
    WHERE ${where.join(' AND ')}
    ORDER BY date, id
  `).all(...params)

  const grouped = {}
  for (const m of list) grouped[m] = new Map()
  for (const r of rows) {
    if (typeof r.value !== 'number') continue
    const byDate = grouped[r.metric]
    if (!byDate.has(r.date)) byDate.set(r.date, { values: [], sources: [] })
    const e = byDate.get(r.date)
    e.values.push(r.value)
    e.sources.push(r.source)
  }

  const series = {}
  for (const m of list) {
    let points = [...grouped[m].entries()].map(([date, e]) => ({
      date,
      value: collapse(e.values, aggregate),
      sources: [...new Set(e.sources)],
    }))
    // `limit` keeps the most recent N points: what an agent usually wants.
    if (opts.limit != null) points = points.slice(-Math.max(0, opts.limit))
    series[m] = points
  }

  const out = { metrics: list, from: from ?? null, to: to ?? null, aggregate, series }
  if (opts.raw) out.rows = rows
  return out
}

// Summary stats per metric for a series (what an agent needs to answer
// "how is my RHR trending" without pulling every point).
export function summarizeSeries(points) {
  if (!points.length) return { count: 0 }
  const vals = points.map(p => p.value)
  return {
    count: vals.length,
    first: points[0],
    last: points[points.length - 1],
    min: Math.min(...vals),
    max: Math.max(...vals),
    avg: vals.reduce((a, b) => a + b, 0) / vals.length,
  }
}

// Resolve a view and fetch the data it charts.
export function getViewData(db, idOrSlug, overrides = {}) {
  const view = getView(db, idOrSlug)
  if (!view) throw new ViewError(`view '${idOrSlug}' not found`, 404)
  const data = queryMetrics(db, view.metrics, {
    aggregate: view.aggregate,
    days: overrides.days ?? view.range_days ?? undefined,
    from: overrides.from,
    to: overrides.to,
  })
  return { view, ...data }
}
