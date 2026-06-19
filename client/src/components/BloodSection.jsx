import { useState } from 'react'
import { api } from '../api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Dot
} from 'recharts'
import LogModal from './LogModal'

function CustomTooltip({ active, payload, label, unit, markerKey }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-1">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      <p className="text-white text-xl font-semibold">
        {d[markerKey]} <span className="text-[#64748b] text-sm font-normal">{unit}</span>
      </p>
      {d.notes && <p className="text-[#7c3aed] text-xs mt-1 italic">{d.notes}</p>}
    </div>
  )
}

function BloodChart({ title, markerKey, entries, unit, color, rangeHigh, rangeLow, optimalHigh, optimalLow }) {
  const filtered = entries.filter(e => e[markerKey] != null)
  const latest = filtered[filtered.length - 1]
  const prev = filtered[filtered.length - 2]
  const delta = latest && prev ? latest[markerKey] - prev[markerKey] : null

  // Determine status
  const val = latest?.[markerKey]
  let status = null
  if (val != null) {
    if (val >= optimalLow && val <= optimalHigh) status = { label: 'Optimal', color: 'text-emerald-400' }
    else if (val >= rangeLow && val <= rangeHigh) status = { label: 'Normal', color: 'text-amber-400' }
    else status = { label: 'Out of range', color: 'text-red-400' }
  }

  const allVals = filtered.map(e => e[markerKey])
  const dataMin = allVals.length ? Math.min(...allVals, optimalLow) : optimalLow
  const dataMax = allVals.length ? Math.max(...allVals, optimalHigh) : optimalHigh
  const padding = (dataMax - dataMin) * 0.25
  const yMin = Math.floor(dataMin - padding)
  const yMax = Math.ceil(dataMax + padding)

  return (
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl p-6 flex flex-col gap-4">
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-white font-semibold text-base">{title}</h3>
          <p className="text-[#475569] text-xs mt-0.5">{unit}</p>
        </div>
        {status && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
            status.label === 'Optimal' ? 'border-emerald-800 bg-emerald-950 text-emerald-400' :
            status.label === 'Normal' ? 'border-amber-800 bg-amber-950 text-amber-400' :
            'border-red-800 bg-red-950 text-red-400'
          }`}>{status.label}</span>
        )}
      </div>

      {/* Latest value */}
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-white">{val ?? '—'}</span>
        {val && <span className="text-[#475569] text-sm mb-0.5">{unit}</span>}
        {delta != null && delta !== 0 && (
          <span className={`text-xs mb-1 font-medium ml-1 ${delta < 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(0)}
          </span>
        )}
      </div>

      {filtered.length < 2 ? (
        <div className="flex items-center justify-center h-40 text-[#2d3d58] text-sm">
          Add at least 2 panels to see trend
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={160}>
          <LineChart data={filtered} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id={`ref-${markerKey}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.08} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" stroke="#1d2a3e" vertical={false} />

            <XAxis
              dataKey="date"
              tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              tick={{ fill: '#475569', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[yMin, yMax]}
              tick={{ fill: '#475569', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickCount={4}
            />

            <Tooltip content={<CustomTooltip unit={unit} markerKey={markerKey} />} />

            {/* Optimal range band */}
            <ReferenceArea
              y1={optimalLow}
              y2={optimalHigh}
              fill={`url(#ref-${markerKey})`}
              stroke="none"
            />
            <ReferenceLine y={optimalHigh} stroke={color} strokeDasharray="4 4" strokeOpacity={0.3} strokeWidth={1} />
            <ReferenceLine y={optimalLow} stroke={color} strokeDasharray="4 4" strokeOpacity={0.3} strokeWidth={1} />

            <Line
              type="monotone"
              dataKey={markerKey}
              stroke={color}
              strokeWidth={2.5}
              dot={{ fill: color, strokeWidth: 0, r: 5 }}
              activeDot={{ r: 6, fill: color, stroke: '#070b12', strokeWidth: 2 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}

      {/* Reference range legend */}
      <div className="flex items-center gap-1 text-[10px] text-[#475569]">
        <div className="w-6 h-px" style={{ borderTop: `1px dashed ${color}`, opacity: 0.4 }} />
        <span>Optimal {optimalLow}–{optimalHigh} {unit}</span>
      </div>
    </div>
  )
}

export default function BloodSection({ data, userId, onRefresh }) {
  const [showLog, setShowLog] = useState(false)
  const entries = data?.entries ?? []
  const markers = data?.markers ?? {}

  return (
    <section id="blood" className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-emerald-500" />
          <h2 className="text-white text-xl font-semibold">Blood</h2>
        </div>
        <button
          onClick={() => setShowLog(true)}
          className="flex items-center gap-2 bg-emerald-700 hover:bg-emerald-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Log Panel
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <BloodChart
          title="Testosterone"
          markerKey="testosterone"
          entries={entries}
          unit="ng/dL"
          color="#a78bfa"
          rangeLow={markers.testosterone?.range_low ?? 300}
          rangeHigh={markers.testosterone?.range_high ?? 1000}
          optimalLow={markers.testosterone?.optimal_low ?? 500}
          optimalHigh={markers.testosterone?.optimal_high ?? 900}
        />
        <BloodChart
          title="Triglycerides"
          markerKey="triglycerides"
          entries={entries}
          unit="mg/dL"
          color="#34d399"
          rangeLow={markers.triglycerides?.range_low ?? 0}
          rangeHigh={markers.triglycerides?.range_high ?? 150}
          optimalLow={markers.triglycerides?.optimal_low ?? 0}
          optimalHigh={markers.triglycerides?.optimal_high ?? 100}
        />
      </div>

      {showLog && (
        <LogModal
          type="blood"
          onClose={() => setShowLog(false)}
          onSave={async (entry) => {
            await api.logBlood(userId, entry)
            onRefresh()
            setShowLog(false)
          }}
        />
      )}
    </section>
  )
}
