import { useState, useEffect, useCallback } from 'react'
import {
  LineChart, Line, BarChart, Bar, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'
import { api } from '../api'

// Custom views (#12): charts saved in the `views` table, added and removed
// from the UI, the REST API, or an agent through the MCP server. Only starred
// views render here; unstarred ones are kept but hidden.

const ACCENT = '#eab308'
const PALETTE = ['#eab308', '#60a5fa', '#f43f5e', '#34d399', '#a78bfa', '#f97316', '#22d3ee', '#7c3aed']

function fmt(v) {
  if (v == null) return '—'
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString() : Number(v.toFixed(2)).toString()
}

function label(metric) {
  return metric.replace(/_/g, ' ')
}

function ViewCard({ userId, view, onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    api.getViewData(userId, view.slug)
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [userId, view.slug, view.updated_at])

  // Merge per-metric series into one row per date for Recharts.
  const rows = []
  if (data) {
    const byDate = {}
    for (const [metric, points] of Object.entries(data.series)) {
      for (const p of points) (byDate[p.date] ??= { date: p.date })[metric] = p.value
    }
    rows.push(...Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date)))
  }

  const hide = async () => { await api.updateView(userId, view.slug, { starred: false }); onChanged() }
  const remove = async () => {
    if (!confirm(`Remove the view "${view.title}"? The underlying data is kept.`)) return
    await api.removeView(userId, view.slug); onChanged()
  }

  const Chart = view.chart === 'bar' ? BarChart : view.chart === 'area' ? AreaChart : LineChart
  const Series = view.chart === 'bar' ? Bar : view.chart === 'area' ? Area : Line

  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-5">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-white font-semibold">{view.title}</h3>
          <p className="text-[#94a3b8] text-xs">
            {view.description || view.metrics.map(label).join(', ')}
            {view.range_days ? ` · last ${view.range_days} days` : ''}
            {view.created_by === 'agent' ? ' · added by agent' : ''}
          </p>
        </div>
        <div className="no-print flex gap-2 text-xs">
          <button onClick={hide} className="text-[#94a3b8] hover:text-white" title="Unstar: hide from the dashboard but keep the view">Hide</button>
          <button onClick={remove} className="text-[#94a3b8] hover:text-[#f43f5e]">Remove</button>
        </div>
      </div>

      {error && <p className="text-[#f43f5e] text-sm">{error}</p>}
      {data && !rows.length && <p className="text-[#94a3b8] text-sm">No data in this range yet.</p>}

      {data && rows.length > 0 && view.chart === 'number' && (
        <div className="flex flex-wrap gap-6">
          {view.metrics.map(m => {
            const pts = data.series[m] ?? []
            const last = pts[pts.length - 1]
            return (
              <div key={m}>
                <div className="text-3xl font-bold text-white">{fmt(last?.value)}</div>
                <div className="text-[#94a3b8] text-xs capitalize">{label(m)}{last ? ` · ${last.date}` : ''}</div>
              </div>
            )
          })}
        </div>
      )}

      {data && rows.length > 0 && view.chart !== 'number' && (
        <ResponsiveContainer width="100%" height={220}>
          <Chart data={rows} margin={{ top: 5, right: 10, bottom: 0, left: -10 }}>
            <CartesianGrid stroke="#243450" strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} domain={['auto', 'auto']} />
            <Tooltip contentStyle={{ background: '#131d2e', border: '1px solid #243450' }} formatter={v => fmt(v)} />
            {view.metrics.length > 1 && <Legend formatter={label} />}
            {view.metrics.map((m, i) => (
              <Series key={m} dataKey={m} name={m} type="monotone" connectNulls
                stroke={PALETTE[i % PALETTE.length]} fill={PALETTE[i % PALETTE.length]}
                fillOpacity={view.chart === 'area' ? 0.2 : 1} dot={rows.length <= 60} />
            ))}
          </Chart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

export default function ViewsSection({ userId }) {
  const [views, setViews] = useState(null)

  const load = useCallback(() => {
    if (!userId) return
    api.getViews(userId, true).then(setViews).catch(() => setViews([]))
  }, [userId])

  // Agents change views out-of-band via the MCP server, so refetch when the
  // tab regains focus rather than only on user switch.
  useEffect(() => {
    load()
    window.addEventListener('focus', load)
    return () => window.removeEventListener('focus', load)
  }, [load])

  return (
    <section id="views" className="mb-16">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-1 h-6 rounded-full" style={{ background: ACCENT }} />
        <h2 className="text-white text-xl font-semibold">Views</h2>
      </div>
      {views && !views.length && (
        <p className="text-[#94a3b8] text-sm">
          No custom views yet. Ask an agent connected through the MCP server to add one
          (for example "add a view of my resting heart rate over the last 90 days").
        </p>
      )}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {views?.map(v => <ViewCard key={v.id} userId={userId} view={v} onChanged={load} />)}
      </div>
    </section>
  )
}
