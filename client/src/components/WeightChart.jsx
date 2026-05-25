import { useState, useMemo } from 'react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Dot
} from 'recharts'

const RANGES = [
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '6M', days: 180 },
  { label: 'All', days: null },
]

function filterByRange(entries, days) {
  if (!days) return entries
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return entries.filter(e => new Date(e.date) >= cutoff)
}

function formatDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  if (days && days <= 7) return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (days && days <= 30) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-1">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      <p className="text-white text-xl font-semibold">{d.weight} <span className="text-[#64748b] text-sm font-normal">lbs</span></p>
      {d.bmi && <p className="text-[#94a3b8] text-xs mt-1">BMI {d.bmi}</p>}
      {d.notes && <p className="text-[#7c3aed] text-xs mt-1 italic">{d.notes}</p>}
    </div>
  )
}

function CustomDot({ cx, cy, payload, events }) {
  const hasEvent = events?.some(e => e.date === payload?.date)
  if (!hasEvent) return null
  return (
    <circle cx={cx} cy={cy} r={5} fill="#a78bfa" stroke="#070b12" strokeWidth={2} />
  )
}

export default function WeightChart({ entries, events = [] }) {
  const [range, setRange] = useState('1M')
  const activeDays = RANGES.find(r => r.label === range)?.days

  const filtered = useMemo(() => filterByRange(entries, activeDays), [entries, activeDays])

  const eventDates = useMemo(() => {
    const visible = events.filter(e => {
      if (!activeDays) return true
      const cutoff = new Date()
      cutoff.setDate(cutoff.getDate() - activeDays)
      return new Date(e.date) >= cutoff
    })
    return visible
  }, [events, activeDays])

  const yMin = useMemo(() => {
    if (!filtered.length) return 160
    return Math.floor(Math.min(...filtered.map(e => e.weight)) - 3)
  }, [filtered])

  const yMax = useMemo(() => {
    if (!filtered.length) return 200
    return Math.ceil(Math.max(...filtered.map(e => e.weight)) + 3)
  }, [filtered])

  const gradientId = 'weightGradient'

  return (
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-white font-semibold text-base">Weight</h3>
          <p className="text-[#475569] text-xs mt-0.5">lbs over time</p>
        </div>
        {/* Range selector */}
        <div className="flex items-center gap-1 bg-[#070b12] border border-[#1d2a3e] rounded-lg p-1">
          {RANGES.map(r => (
            <button
              key={r.label}
              onClick={() => setRange(r.label)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                range === r.label
                  ? 'bg-[#7c3aed] text-white shadow'
                  : 'text-[#64748b] hover:text-[#94a3b8]'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* Latest value display */}
      {filtered.length > 0 && (
        <div className="flex items-end gap-3 mb-6">
          <span className="text-4xl font-bold text-white">
            {filtered[filtered.length - 1].weight}
          </span>
          <span className="text-[#475569] text-sm mb-1">lbs</span>
          {filtered.length > 1 && (() => {
            const delta = (filtered[filtered.length - 1].weight - filtered[0].weight).toFixed(1)
            const isDown = delta < 0
            return (
              <span className={`text-sm mb-1 font-medium ${isDown ? 'text-emerald-400' : 'text-red-400'}`}>
                {isDown ? '↓' : '↑'} {Math.abs(delta)} lbs
              </span>
            )
          })()}
        </div>
      )}

      {/* Chart */}
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={filtered} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#7c3aed" stopOpacity={0.35} />
              <stop offset="100%" stopColor="#7c3aed" stopOpacity={0} />
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

          {/* Event reference lines */}
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

          <Area
            type="monotone"
            dataKey="weight"
            stroke="#a78bfa"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={(props) => <CustomDot {...props} events={eventDates} />}
            activeDot={{ r: 5, fill: '#a78bfa', stroke: '#070b12', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>

      {/* Legend for event markers */}
      {eventDates.length > 0 && (
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-[#1d2a3e]">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-px bg-emerald-400 opacity-70" style={{ borderTop: '2px dashed #34d399' }} />
            <span className="text-[#475569] text-xs">Blood draw</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-px opacity-70" style={{ borderTop: '2px dashed #fbbf24' }} />
            <span className="text-[#475569] text-xs">Doctor visit</span>
          </div>
        </div>
      )}
    </div>
  )
}
