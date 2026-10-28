#!/usr/bin/env node
// MCP server (#12): lets an agent query health data and add/remove dashboard
// views. Speaks MCP over stdio and reads/writes the same per-user SQLite files
// as server.js (DATA_DIR), through the same views.js / metrics-query.js layer
// the REST API uses, so the dashboard picks changes up on its next load.
//
// Deliberately independent of server.js: no Express, and no ANTHROPIC_API_KEY.
//
//   DATA_DIR=./data HEALTH_USER_ID=spencer node mcp-server.js

import dotenv from 'dotenv'
import { pathToFileURL } from 'url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

import { getDb, readUsers } from './db.js'
import { listViews, addView, updateView, removeView, ViewError, CHART_TYPES, AGGREGATES } from './views.js'
import { listMetrics, queryMetrics, getViewData, summarizeSeries } from './metrics-query.js'

// stdout is the MCP protocol channel. dotenv 17 announces itself on stdout and
// db.js logs migrations with console.log, so silence the one and reroute the other.
dotenv.config({ quiet: true })
console.log = (...a) => console.error(...a)

const ok = data => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] })
const fail = message => ({ content: [{ type: 'text', text: message }], isError: true })

// Resolve which profile a call targets: explicit user_id, else HEALTH_USER_ID,
// else the only profile if there is exactly one.
function resolveUser(userId) {
  const users = readUsers()
  const id = userId || process.env.HEALTH_USER_ID
  if (id) {
    if (!users.some(u => u.id === id)) throw new ViewError(`user '${id}' not found; call list_users`, 404)
    return id
  }
  if (users.length === 1) return users[0].id
  throw new ViewError(users.length
    ? `user_id is required (profiles: ${users.map(u => u.id).join(', ')})`
    : 'no profiles exist yet; create one in the dashboard first')
}

// Wrap a handler so ViewErrors come back as tool errors the model can read and
// correct, instead of protocol errors.
const tool = fn => async args => {
  try { return ok(await fn(args)) }
  catch (err) { return fail(err instanceof ViewError ? err.message : `Error: ${err.message}`) }
}

const userArg = { user_id: z.string().optional().describe('Profile id (see list_users). Optional when HEALTH_USER_ID is set or only one profile exists.') }
const viewRef = z.union([z.string(), z.number().int()]).describe('View id or slug')

export function createServer() {
  const server = new McpServer({ name: 'health-dashboard', version: '1.0.0' })

  server.registerTool('list_users', {
    title: 'List profiles',
    description: 'List the dashboard profiles (each has its own isolated data).',
    inputSchema: {},
    annotations: { readOnlyHint: true },
  }, tool(() => readUsers().map(({ id, name, birth_year, height_inches }) => ({ id, name, birth_year, height_inches }))))

  server.registerTool('list_metrics', {
    title: 'List metrics',
    description: 'List every metric key stored for a profile (e.g. weight, resting_heart_rate, sleep_hours, ldl) with data counts, date span, sources and latest value. Use this to discover metric keys before querying or creating a view.',
    inputSchema: { ...userArg, search: z.string().optional().describe('Substring filter on the metric key') },
    annotations: { readOnlyHint: true },
  }, tool(({ user_id, search }) => listMetrics(getDb(resolveUser(user_id)), { search })))

  server.registerTool('query_metrics', {
    title: 'Query metrics',
    description: 'Daily time series for one or more metrics, with min/max/avg/first/last summaries. Dates are local calendar days (YYYY-MM-DD).',
    inputSchema: {
      ...userArg,
      metrics: z.array(z.string()).min(1).describe('Metric keys from list_metrics'),
      from: z.string().optional().describe('Start date YYYY-MM-DD (inclusive)'),
      to: z.string().optional().describe('End date YYYY-MM-DD (inclusive)'),
      days: z.number().int().positive().optional().describe('Shortcut: the last N days (ignored if from is set)'),
      source: z.string().optional().describe('Only rows from this source (e.g. apple_health, manual, pdf_import)'),
      aggregate: z.enum(AGGREGATES).optional().describe("How to combine several sources on one day. Default 'last'."),
      limit: z.number().int().positive().optional().describe('Keep only the most recent N points per metric'),
      summary_only: z.boolean().optional().describe('Return only summaries, not every point'),
    },
    annotations: { readOnlyHint: true },
  }, tool(({ user_id, metrics, summary_only, ...opts }) => {
    const result = queryMetrics(getDb(resolveUser(user_id)), metrics, opts)
    result.summary = Object.fromEntries(Object.entries(result.series).map(([m, pts]) => [m, summarizeSeries(pts)]))
    if (summary_only) delete result.series
    return result
  }))

  server.registerTool('list_views', {
    title: 'List dashboard views',
    description: 'List the custom views on the dashboard. Starred views are shown; unstarred ones are kept but hidden.',
    inputSchema: { ...userArg, starred_only: z.boolean().optional() },
    annotations: { readOnlyHint: true },
  }, tool(({ user_id, starred_only }) => listViews(getDb(resolveUser(user_id)), { starredOnly: !!starred_only })))

  server.registerTool('get_view_data', {
    title: 'Get view data',
    description: 'Fetch the data a view charts, using its saved metrics, aggregate and range.',
    inputSchema: { ...userArg, view: viewRef, days: z.number().int().positive().optional().describe('Override the saved range') },
    annotations: { readOnlyHint: true },
  }, tool(({ user_id, view, days }) => getViewData(getDb(resolveUser(user_id)), view, { days })))

  server.registerTool('add_view', {
    title: 'Add dashboard view',
    description: 'Add a chart to the dashboard for one or more metrics (e.g. "Outdoor run pace" over running_pace). Check list_metrics for valid keys first.',
    inputSchema: {
      ...userArg,
      title: z.string().min(1),
      metrics: z.array(z.string()).min(1).describe('Metric keys to chart'),
      description: z.string().optional(),
      slug: z.string().optional().describe('Stable id; derived from the title if omitted'),
      chart: z.enum(CHART_TYPES).optional().describe("Default 'line'. 'number' shows the latest value."),
      aggregate: z.enum(AGGREGATES).optional(),
      range_days: z.number().int().positive().optional().describe('Default time window; omit for all time'),
      starred: z.boolean().optional().describe('Show on the dashboard (default true)'),
      position: z.number().int().optional(),
      allow_unknown_metrics: z.boolean().optional().describe('Allow metric keys with no data yet (default false)'),
    },
  }, tool(({ user_id, allow_unknown_metrics, ...spec }) => {
    const db = getDb(resolveUser(user_id))
    if (!allow_unknown_metrics) {
      const known = new Set(listMetrics(db).map(m => m.metric))
      const unknown = spec.metrics.filter(m => !known.has(m))
      if (unknown.length) throw new ViewError(`no data for metric(s): ${unknown.join(', ')}. Check list_metrics, or pass allow_unknown_metrics: true.`)
    }
    return addView(db, { ...spec, created_by: 'agent' })
  }))

  server.registerTool('update_view', {
    title: 'Update dashboard view',
    description: 'Change a view: retitle it, change its metrics/chart/range, reorder it, or star/unstar it (unstar hides it without deleting).',
    inputSchema: {
      ...userArg,
      view: viewRef,
      title: z.string().min(1).optional(),
      metrics: z.array(z.string()).min(1).optional(),
      description: z.string().nullable().optional(),
      chart: z.enum(CHART_TYPES).optional(),
      aggregate: z.enum(AGGREGATES).optional(),
      range_days: z.number().int().positive().nullable().optional(),
      starred: z.boolean().optional(),
      position: z.number().int().optional(),
    },
  }, tool(({ user_id, view, ...patch }) => updateView(getDb(resolveUser(user_id)), view, patch)))

  server.registerTool('remove_view', {
    title: 'Remove dashboard view',
    description: 'Delete a custom view from the dashboard. Only the view is removed; the underlying metric data is untouched.',
    inputSchema: { ...userArg, view: viewRef },
    annotations: { destructiveHint: true, idempotentHint: true },
  }, tool(({ user_id, view }) => ({ ok: true, removed: removeView(getDb(resolveUser(user_id)), view) })))

  return server
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await createServer().connect(new StdioServerTransport())
  // stdout is the protocol channel: log to stderr only.
  console.error('[mcp] health-dashboard MCP server ready on stdio')
}
