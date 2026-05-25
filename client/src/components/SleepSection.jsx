import { useState } from 'react'
import { api } from '../api'
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import LogModal from './LogModal'

const OPTIMAL_MIN = 7
const OPTIMAL_MAX = 9

function sleepColor(hours) {
  if (hours >= OPTIMAL_MIN && hours <= OPTIMAL_MAX) return '#60a5fa'
  if (hours >= 6 && hours <= 10) return '#f59e0b'
  return '#f87171'
}

function fmt(hours) {
  if (hours == null) return '—'
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function avg(arr) {
  const vals = arr.filter(v => v != null)
  if (!vals.length) return null
  return vals.reduce((a, b) => a + b, 0) / vals.length
}

function StatCard({ label, value, sublabel, color = '#60a5fa' }) {
  return (
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl p-5 flex flex-col gap-2">
      <span className="text-[#475569] text-xs font-medium uppercase tracking-wider">{label}</span>
      <span className="text-3xl font-bold" style={{ color: value ? color : '#2d3d58' }}>
        {value ? fmt(value) : '—'}
      </span>
      {sublabel && <span className="text-[#475569] text-xs">{sublabel}</span>}
    </div>
  )
}

function CustomTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d?.sleep_hours) return null
  return (
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-1">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      <p className="text-white text-xl font-semibold">{fmt(d.sleep_hours)}</p>
      {d.sleep_quality != null && (
        <p className="text-[#64748b] text-xs mt-0.5">Quality {d.sleep_quality}/10</p>
      )}
      {d.notes && <p className="text-[#7c3aed] text-xs mt-1 italic">{d.notes}</p>}
    </div>
  )
}

export default function SleepSection({ data, userId, onRefresh }) {
  const [showLog, setShowLog] = useState(false)
  const entries = data?.entries ?? []
  const withHours = entries.filter(e => e.sleep_hours != null)

  const last7  = withHours.slice(-7).map(e => e.sleep_hours)
  const last30 = withHours.slice(-30).map(e => e.sleep_hours)
  const latest = withHours[withHours.length - 1]

  const avg7  = avg(last7)
  const avg30 = avg(last30)

  const latestColor = latest ? sleepColor(latest.sleep_hours) : '#60a5fa'

  return (
    <section id="sleep" className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-[#60a5fa]" />
          <h2 className="text-white text-xl font-semibold">Sleep</h2>
        </div>
        <button
          onClick={() => setShowLog(true)}
          className="flex items-center gap-2 bg-[#3b82f6] hover:bg-[#2563eb] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
        >
          <span className="text-base leading-none">+</span>
          Log Sleep
        </button>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <StatCard
          label="Last Night"
          value={latest?.sleep_hours}
          sublabel={latest ? new Date(latest.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'No data yet'}
          color={latestColor}
        />
        <StatCard
          label="7-Day Avg"
          value={avg7}
          sublabel={last7.length ? `Based on ${last7.length} nights` : 'No data yet'}
          color={avg7 ? sleepColor(avg7) : '#60a5fa'}
        />
        <StatCard
          label="30-Day Avg"
          value={avg30}
          sublabel={last30.length ? `Based on ${last30.length} nights` : 'No data yet'}
          color={avg30 ? sleepColor(avg30) : '#60a5fa'}
        />
      </div>

      {/* Bar chart */}
      <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl p-6">
        {withHours.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-[#2d3d58] text-sm">
            No sleep data yet — log a night or sync Apple Health
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={withHours.slice(-60)} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barSize={withHours.length > 30 ? 6 : 10}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1d2a3e" vertical={false} />
                <XAxis
                  dataKey="date"
                  tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  tick={{ fill: '#475569', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  domain={[0, 12]}
                  tick={{ fill: '#475569', fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickCount={5}
                  tickFormatter={v => `${v}h`}
                />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceArea y1={OPTIMAL_MIN} y2={OPTIMAL_MAX} fill="#60a5fa" fillOpacity={0.06} stroke="none" />
                <ReferenceLine y={OPTIMAL_MAX} stroke="#60a5fa" strokeDasharray="4 4" strokeOpacity={0.35} strokeWidth={1} />
                <ReferenceLine y={OPTIMAL_MIN} stroke="#60a5fa" strokeDasharray="4 4" strokeOpacity={0.35} strokeWidth={1} />
                <Bar dataKey="sleep_hours" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                  {withHours.slice(-60).map((e, i) => (
                    <Cell key={i} fill={sleepColor(e.sleep_hours)} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>

            <div className="flex items-center gap-4 mt-3 text-[10px] text-[#475569]">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-[#60a5fa] opacity-80" />
                <span>Optimal {OPTIMAL_MIN}–{OPTIMAL_MAX}h</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-[#f59e0b] opacity-80" />
                <span>Borderline</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm bg-[#f87171] opacity-80" />
                <span>Poor</span>
              </div>
            </div>
          </>
        )}
      </div>

      {showLog && (
        <LogModal
          type="sleep"
          onClose={() => setShowLog(false)}
          onSave={async (entry) => {
            await api.logSleep(userId, entry)
            onRefresh()
            setShowLog(false)
          }}
        />
      )}
    </section>
  )
}
