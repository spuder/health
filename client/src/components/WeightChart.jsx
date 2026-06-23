import { useState, useMemo } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'

const RANGES = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '6M', days: 180 },
  { label: 'All', days: null },
]

const SOURCE_META = {
  apple_health: { label: 'Apple Health', color: '#a78bfa' },
  pdf_import:   { label: 'InBody',       color: '#f97316' },
  manual:       { label: 'Manual',       color: '#60a5fa' },
}

function filterByRange(points, days) {
  if (!days) return points
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return points.filter(p => new Date(p.date) >= cutoff)
}

function formatDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  if (days && days <= 7) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const entries = payload.filter(p => p.value != null)
  if (!entries.length) return null
  return (
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-2">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      {entries.map(p => (
        <div key={p.dataKey} className="flex items-center gap-2 text-sm">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: p.color }} />
          <span style={{ color: p.color }} className="font-semibold">{p.value}</span>
          <span className="text-[#64748b] text-xs">lbs</span>
          <span className="text-[#475569] text-xs">{SOURCE_META[p.dataKey]?.label}</span>
        </div>
      ))}
    </div>
  )
}

export default function WeightChart({ entries = [], weightBySource = {}, events = [] }) {
  const [range, setRange] = useState('1M')
  const activeDays = RANGES.find(r => r.label === range)?.days

  // Fall back to entries prop when server hasn't returned weightBySource yet
  const effectiveBySource = useMemo(() => {
    if (Object.keys(weightBySource).length > 0) return weightBySource
    const pts = entries.filter(e => e.weight != null).map(e => ({ date: e.date, value: e.weight }))
    return pts.length ? { weight: pts } : {}
  }, [weightBySource, entries])

  const chartData = useMemo(() => {
    const dateSet = new Set()
    for (const [, points] of Object.entries(effectiveBySource)) {
      for (const p of filterByRange(points, activeDays)) dateSet.add(p.date)
    }
    const dates = [...dateSet].sort()
    return dates.map(date => {
      const entry = { date }
      for (const [source, points] of Object.entries(effectiveBySource)) {
        const point = points.find(p => p.date === date)
        if (point) entry[source] = point.value
      }
      return entry
    })
  }, [effectiveBySource, activeDays])

  const activeSources = useMemo(() =>
    Object.keys(effectiveBySource).filter(s => filterByRange(effectiveBySource[s], activeDays).length > 0),
    [effectiveBySource, activeDays]
  )

  const eventDates = useMemo(() => {
    if (!activeDays) return events
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - activeDays)
    return events.filter(e => new Date(e.date) >= cutoff)
  }, [events, activeDays])

  const allValues = chartData.flatMap(d =>
    activeSources.map(s => d[s]).filter(v => v != null)
  )
  const yMin = allValues.length ? Math.floor(Math.min(...allValues) - 3) : 160
  const yMax = allValues.length ? Math.ceil(Math.max(...allValues) + 3) : 200

  // Latest weight: prefer apple_health recency, fall back to any source
  const preferredSource = activeSources.includes('apple_health') ? 'apple_health' : activeSources[0]
  const rangePoints = preferredSource ? filterByRange(effectiveBySource[preferredSource] ?? [], activeDays) : []
  const latestWeight = rangePoints.length ? rangePoints[rangePoints.length - 1].value : null
  const delta = rangePoints.length > 1
    ? (rangePoints[rangePoints.length - 1].value - rangePoints[0].value).toFixed(1)
    : null

  const showDots = chartData.length <= 60

  return (
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-semibold text-base">Weight</h3>
          <p className="text-[#475569] text-xs mt-0.5">lbs over time</p>
        </div>
        <div className="flex items-center gap-1 bg-[#070b12] border border-[#1d2a3e] rounded-lg p-1">
          {RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRange(r.label)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                range === r.label ? 'bg-[#7c3aed] text-white shadow' : 'text-[#64748b] hover:text-[#94a3b8]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Latest value */}
      {latestWeight != null && (
        <div className="flex items-end gap-3 mb-6">
          <span className="text-4xl font-bold text-white">{latestWeight}</span>
          <span className="text-[#475569] text-sm mb-1">lbs</span>
          {delta != null && Number(delta) !== 0 && (
            <span className={`text-sm mb-1 font-medium ${delta < 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {delta < 0 ? '↓' : '↑'} {Math.abs(delta)} lbs
            </span>
          )}
        </div>
      )}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="weightGradientAH" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a78bfa" stopOpacity={0.25} />
              <stop offset="100%" stopColor="#a78bfa" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#1d2a3e" vertical={false} />

          <XAxis
            dataKey="date"
            tickFormatter={(d) => formatDate(d, activeDays)}
            tick={{ fill: '#475569', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />

          <YAxis
            domain={[yMin, yMax]}
            tick={{ fill: '#475569', fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickCount={5}
          />

          <Tooltip content={<CustomTooltip />} />

          {eventDates.map((ev, i) => (
            <ReferenceLine
              key={i}
              x={ev.date}
              stroke={ev.type === 'blood_draw' ? '#34d399' : '#fbbf24'}
              strokeDasharray="3 3"
              strokeWidth={1.5}
              strokeOpacity={0.6}
            />
          ))}

          {/* Apple Health — area fill + line */}
          {activeSources.includes('apple_health') && (
            <Area
              type="monotone"
              dataKey="apple_health"
              stroke="#a78bfa"
              strokeWidth={2}
              fill="url(#weightGradientAH)"
              connectNulls={false}
              dot={showDots ? { r: 3, fill: '#a78bfa', strokeWidth: 0 } : false}
              activeDot={{ r: 5, fill: '#a78bfa', stroke: '#070b12', strokeWidth: 2 }}
            />
          )}

          {/* InBody / manual / fallback — line with prominent dots */}
          {activeSources.filter(s => s !== 'apple_health').map(source => {
            const color = SOURCE_META[source]?.color ?? '#94a3b8'
            return (
              <Line
                key={source}
                type="monotone"
                dataKey={source}
                stroke={color}
                strokeWidth={2}
                connectNulls={false}
                dot={{ r: 5, fill: color, stroke: '#070b12', strokeWidth: 2 }}
                activeDot={{ r: 7, fill: color, stroke: '#070b12', strokeWidth: 2 }}
              />
            )
          })}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      {(activeSources.length > 0 || eventDates.length > 0) && (
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-[#1d2a3e] flex-wrap">
          {activeSources.map(source => {
            const meta = SOURCE_META[source] ?? { label: source, color: '#94a3b8' }
            return (
              <div key={source} className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 rounded-full" style={{ background: meta.color }} />
                <span className="text-[#475569] text-xs">{meta.label}</span>
              </div>
            )
          })}
          {eventDates.some(e => e.type === 'blood_draw') && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-px opacity-70" style={{ borderTop: '2px dashed #34d399' }} />
              <span className="text-[#475569] text-xs">Blood draw</span>
            </div>
          )}
          {eventDates.some(e => e.type !== 'blood_draw') && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-px opacity-70" style={{ borderTop: '2px dashed #fbbf24' }} />
              <span className="text-[#475569] text-xs">Doctor visit</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
