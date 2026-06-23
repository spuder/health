import { useState, useMemo } from 'react'
import RawDataModal from './RawDataModal'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'

const BRADYCARDIA_THRESHOLD = 40
const Y_MIN = 35

const RANGES = [
  { label: '1W',  days: 7   },
  { label: '1M',  days: 30  },
  { label: '3M',  days: 90  },
  { label: '6M',  days: 180 },
  { label: '1Y',  days: 365 },
]

const COLOR = '#f43f5e'

function filterByRange(entries, days) {
  if (!days) return entries
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  return entries.filter(e => new Date(e.date + 'T00:00:00') >= cutoff)
}

function avg(entries, key) {
  const vals = entries.map(e => e[key]).filter(v => v != null)
  if (!vals.length) return null
  return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
}

function rhrColor(bpm) {
  if (bpm == null) return COLOR
  if (bpm < BRADYCARDIA_THRESHOLD) return '#f59e0b'
  if (bpm < 60) return '#34d399'
  if (bpm <= 75) return COLOR
  return '#f59e0b'
}

function formatTick(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00')
  if (days <= 7)  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
  if (days <= 30) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  if (days <= 90) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
}

function StatCard({ label, value, unit = 'bpm', sublabel }) {
  const color = rhrColor(value)
  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-5 flex flex-col gap-2">
      <span className="text-[#475569] text-xs font-medium uppercase tracking-wider">{label}</span>
      <div className="flex items-end gap-1.5">
        <span className="text-3xl font-bold" style={{ color: value != null ? color : '#374d6c' }}>
          {value ?? '—'}
        </span>
        {value != null && <span className="text-[#475569] text-sm mb-0.5">{unit}</span>}
      </div>
      {sublabel && <span className="text-[#475569] text-xs">{sublabel}</span>}
    </div>
  )
}

function RhrTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-1">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      {d.resting_heart_rate != null && (
        <p className="text-white text-xl font-semibold">
          {Math.round(d.resting_heart_rate)} <span className="text-[#64748b] text-sm font-normal">bpm</span>
        </p>
      )}
      {d.hrv != null && (
        <p className="text-[#94a3b8] text-xs mt-1">HRV {Math.round(d.hrv)} ms</p>
      )}
    </div>
  )
}

export default function HeartRateSection({ data }) {
  const [range, setRange] = useState('1M')
  const [showRaw, setShowRaw] = useState(false)
  const activeDays = RANGES.find(r => r.label === range)?.days

  const entries = data?.entries ?? []
  const withRhr = useMemo(() => entries.filter(e => e.resting_heart_rate != null), [entries])

  const filtered = useMemo(() => filterByRange(withRhr, activeDays), [withRhr, activeDays])

  const latest = withRhr[withRhr.length - 1]
  const avg7   = avg(filterByRange(withRhr, 7),  'resting_heart_rate')
  const avg30  = avg(filterByRange(withRhr, 30), 'resting_heart_rate')

  const yMin = useMemo(() => {
    if (!filtered.length) return Y_MIN
    return Math.min(Y_MIN, Math.floor(Math.min(...filtered.map(e => e.resting_heart_rate)) - 5))
  }, [filtered])

  const yMax = useMemo(() => {
    if (!filtered.length) return 100
    return Math.ceil(Math.max(...filtered.map(e => e.resting_heart_rate)) + 5)
  }, [filtered])

  const showDots = filtered.length <= 60

  return (
    <section id="heartrate" className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full" style={{ background: COLOR }} />
          <h2 className="text-white text-xl font-semibold">Resting Heart Rate</h2>
        </div>
        <button onClick={() => setShowRaw(true)} className="font-mono text-[10px] text-[#243450] hover:text-[#475569] px-1 transition-colors" title="raw data">{'{}'}</button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard
          label="Latest"
          value={latest?.resting_heart_rate != null ? Math.round(latest.resting_heart_rate) : null}
          sublabel={latest ? new Date(latest.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No data yet'}
        />
        <StatCard
          label="7-Day Avg"
          value={avg7}
          sublabel={avg7 != null ? 'Last 7 days' : 'No data yet'}
        />
        <StatCard
          label="30-Day Avg"
          value={avg30}
          sublabel={avg30 != null ? 'Last 30 days' : 'No data yet'}
        />
      </div>

      {/* Chart */}
      <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <p className="text-white text-sm font-medium">Resting Heart Rate</p>
            <p className="text-[#475569] text-xs mt-0.5">bpm over time</p>
          </div>
          <div className="flex items-center gap-1 bg-[#0d1520] border border-[#243450] rounded-lg p-1">
            {RANGES.map(r => (
              <button
                key={r.label}
                onClick={() => setRange(r.label)}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                  range === r.label
                    ? 'text-white shadow'
                    : 'text-[#64748b] hover:text-[#94a3b8]'
                }`}
                style={range === r.label ? { background: COLOR } : {}}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-[#374d6c] text-sm">
            No resting heart rate data — sync Apple Health to populate
          </div>
        ) : (
          <>
            <div className="flex items-end gap-3 mb-6">
              <span className="text-4xl font-bold text-white">
                {Math.round(filtered[filtered.length - 1].resting_heart_rate)}
              </span>
              <span className="text-[#475569] text-sm mb-1">bpm</span>
              {filtered.length > 1 && (() => {
                const delta = Math.round(filtered[filtered.length - 1].resting_heart_rate - filtered[0].resting_heart_rate)
                const isDown = delta < 0
                return (
                  <span className={`text-sm mb-1 font-medium ${isDown ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {isDown ? '↓' : '↑'} {Math.abs(delta)} bpm
                  </span>
                )
              })()}
            </div>

            {/* key forces Recharts to remount the chart when range changes, so Y-axis domain updates correctly */}
            <ResponsiveContainer width="100%" height={220} key={range}>
              <AreaChart data={filtered} margin={{ top: 8, right: 4, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="rhrGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={COLOR} stopOpacity={0.3} />
                    <stop offset="100%" stopColor={COLOR} stopOpacity={0} />
                  </linearGradient>
                </defs>

                <CartesianGrid strokeDasharray="3 3" stroke="#243450" vertical={false} />

                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => formatTick(d, activeDays)}
                  tick={{ fill: '#475569', fontSize: 10 }}
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
                  tickFormatter={v => `${v}`}
                />

                <Tooltip content={<RhrTooltip />} />

                <ReferenceArea y1={Y_MIN} y2={BRADYCARDIA_THRESHOLD} fill="#f59e0b" fillOpacity={0.07} stroke="none" />
                <ReferenceLine y={BRADYCARDIA_THRESHOLD} stroke="#f59e0b" strokeDasharray="4 4" strokeOpacity={0.5} strokeWidth={1} label={{ value: 'Bradycardia', position: 'insideTopLeft', fill: '#f59e0b', fontSize: 10, opacity: 0.7 }} />

                <Area
                  type="monotone"
                  dataKey="resting_heart_rate"
                  stroke={COLOR}
                  strokeWidth={2}
                  fill="url(#rhrGradient)"
                  isAnimationActive={false}
                  dot={showDots ? { r: 3, fill: COLOR, strokeWidth: 0 } : false}
                  activeDot={{ r: 5, fill: COLOR, stroke: '#0d1520', strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>

          </>
        )}
      </div>
      {showRaw && <RawDataModal label="heart rate" data={data} onClose={() => setShowRaw(false)} />}
    </section>
  )
}
