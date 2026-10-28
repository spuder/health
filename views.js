// Dashboard views: the data model shared by the REST API (server.js), the MCP
// server (mcp-server.js) and, later, starable metrics (#13).
//
// A view is a saved, named chart over one or more metric keys in the EAV
// `metrics` table. Nothing here knows about HTTP or MCP: callers pass a
// better-sqlite3 handle (getDb(userId)) and get plain objects back, and bad
// input throws a ViewError carrying an HTTP-ish status the caller can map.
//
// `starred` is the visibility flag: starred views render on the dashboard,
// unstarred ones are kept (with their config) but hidden. Removing a view
// deletes it outright. #13 can build "star a metric" as addView/updateView.

export const VIEW_KINDS = ['metric_chart']
export const CHART_TYPES = ['line', 'bar', 'area', 'number']
// How several sources reporting the same metric on the same day collapse into
// one point. `last` (highest row id wins) matches pivotMetrics() in server.js.
export const AGGREGATES = ['last', 'avg', 'sum', 'min', 'max']
export const MAX_METRICS_PER_VIEW = 8

export class ViewError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.name = 'ViewError'
    this.status = status
  }
}

export function slugify(text) {
  return String(text)
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
    .replace(/-+$/, '')
}

function rowToView(row) {
  if (!row) return null
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    description: row.description,
    kind: row.kind,
    metrics: JSON.parse(row.metrics_json),
    chart: row.chart,
    aggregate: row.aggregate,
    range_days: row.range_days,
    starred: !!row.starred,
    position: row.position,
    created_by: row.created_by,
    created_at: row.created_at,
    updated_at: row.updated_at,
  }
}

// Validate a (possibly partial) view spec. `partial` = update semantics: only
// keys present are checked and returned.
function normalizeSpec(spec, { partial = false } = {}) {
  if (!spec || typeof spec !== 'object') throw new ViewError('view spec must be an object')
  const out = {}
  const has = k => spec[k] !== undefined

  if (has('title') || !partial) {
    if (typeof spec.title !== 'string' || !spec.title.trim()) throw new ViewError('title is required')
    out.title = spec.title.trim().slice(0, 120)
  }
  if (has('description')) {
    if (spec.description !== null && typeof spec.description !== 'string') throw new ViewError('description must be a string')
    out.description = spec.description?.trim() || null
  }
  if (has('kind')) {
    if (!VIEW_KINDS.includes(spec.kind)) throw new ViewError(`kind must be one of: ${VIEW_KINDS.join(', ')}`)
    out.kind = spec.kind
  }
  if (has('metrics') || !partial) {
    const metrics = typeof spec.metrics === 'string' ? [spec.metrics] : spec.metrics
    if (!Array.isArray(metrics) || !metrics.length) throw new ViewError('metrics must be a non-empty array of metric keys')
    if (metrics.length > MAX_METRICS_PER_VIEW) throw new ViewError(`a view can chart at most ${MAX_METRICS_PER_VIEW} metrics`)
    for (const m of metrics) {
      if (typeof m !== 'string' || !/^[a-z0-9_]+$/.test(m)) throw new ViewError(`invalid metric key '${m}' (expected snake_case, e.g. resting_heart_rate)`)
    }
    out.metrics = [...new Set(metrics)]
  }
  if (has('chart')) {
    if (!CHART_TYPES.includes(spec.chart)) throw new ViewError(`chart must be one of: ${CHART_TYPES.join(', ')}`)
    out.chart = spec.chart
  }
  if (has('aggregate')) {
    if (!AGGREGATES.includes(spec.aggregate)) throw new ViewError(`aggregate must be one of: ${AGGREGATES.join(', ')}`)
    out.aggregate = spec.aggregate
  }
  if (has('range_days')) {
    const r = spec.range_days
    if (r !== null && !(Number.isInteger(r) && r > 0 && r <= 3650)) throw new ViewError('range_days must be a positive integer (max 3650) or null for all time')
    out.range_days = r
  }
  if (has('starred')) out.starred = spec.starred ? 1 : 0
  if (has('position')) {
    if (!Number.isInteger(spec.position)) throw new ViewError('position must be an integer')
    out.position = spec.position
  }
  if (has('created_by')) {
    if (!['user', 'agent'].includes(spec.created_by)) throw new ViewError("created_by must be 'user' or 'agent'")
    out.created_by = spec.created_by
  }
  return out
}

export function listViews(db, { starredOnly = false } = {}) {
  const rows = db.prepare(`
    SELECT * FROM views ${starredOnly ? 'WHERE starred = 1' : ''} ORDER BY position, id
  `).all()
  return rows.map(rowToView)
}

// Look up by numeric id or slug.
export function getView(db, idOrSlug) {
  const asId = typeof idOrSlug === 'number' || /^\d+$/.test(String(idOrSlug))
  const row = asId
    ? db.prepare(`SELECT * FROM views WHERE id = ?`).get(Number(idOrSlug))
    : db.prepare(`SELECT * FROM views WHERE slug = ?`).get(String(idOrSlug))
  return rowToView(row)
}

function requireView(db, idOrSlug) {
  const view = getView(db, idOrSlug)
  if (!view) throw new ViewError(`view '${idOrSlug}' not found`, 404)
  return view
}

export function addView(db, spec) {
  const v = normalizeSpec(spec)
  const slug = spec.slug !== undefined ? slugify(spec.slug) : slugify(v.title)
  if (!slug) throw new ViewError('could not derive a slug from the title; pass an explicit slug')
  if (/^\d+$/.test(slug)) throw new ViewError('slug cannot be purely numeric')
  if (getView(db, slug)) throw new ViewError(`a view with slug '${slug}' already exists`, 409)

  const position = v.position ?? (db.prepare(`SELECT COALESCE(MAX(position), -1) + 1 AS p FROM views`).get().p)
  const info = db.prepare(`
    INSERT INTO views (slug, title, description, kind, metrics_json, chart, aggregate, range_days, starred, position, created_by)
    VALUES (@slug, @title, @description, @kind, @metrics_json, @chart, @aggregate, @range_days, @starred, @position, @created_by)
  `).run({
    slug,
    title: v.title,
    description: v.description ?? null,
    kind: v.kind ?? 'metric_chart',
    metrics_json: JSON.stringify(v.metrics),
    chart: v.chart ?? 'line',
    aggregate: v.aggregate ?? 'last',
    range_days: v.range_days ?? null,
    starred: v.starred ?? 1,
    position,
    created_by: v.created_by ?? 'user',
  })
  return getView(db, Number(info.lastInsertRowid))
}

export function updateView(db, idOrSlug, patch) {
  const view = requireView(db, idOrSlug)
  const v = normalizeSpec(patch, { partial: true })
  delete v.created_by  // provenance is fixed at creation
  const cols = Object.keys(v)
  if (!cols.length) return view
  const params = { id: view.id, ...v }
  if (v.metrics) { params.metrics_json = JSON.stringify(v.metrics); delete params.metrics }
  const sets = Object.keys(params).filter(k => k !== 'id').map(k => `${k} = @${k}`)
  db.prepare(`UPDATE views SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = @id`).run(params)
  return getView(db, view.id)
}

export function removeView(db, idOrSlug) {
  const view = requireView(db, idOrSlug)
  db.prepare(`DELETE FROM views WHERE id = ?`).run(view.id)
  return view
}
