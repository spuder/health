import { useState } from 'react'
import { api } from '../api'
import RawDataModal from './RawDataModal'
import {
  BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer,
} from 'recharts'
import LogModal from './LogModal'

const TARGET_MINUTES = 30   // daily exercise goal
const TARGET_HR_MINS = 20   // daily zone-2+ goal

function exColor(minutes) {
  if (minutes >= TARGET_MINUTES) return '#f97316'
  if (minutes >= TARGET_MINUTES * 0.5) return '#f59e0b'
  return '#475569'
}

function hrColor(minutes) {
  if (minutes >= TARGET_HR_MINS) return '#ef4444'
  if (minutes >= TARGET_HR_MINS * 0.5) return '#f59e0b'
  return '#475569'
}

function since(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return d
}

function StatCard({ label, value, unit, sublabel, color }) {
  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-5 flex flex-col gap-2">
      <span className="text-[#475569] text-xs font-medium uppercase tracking-wider">{label}</span>
      <div className="flex items-end gap-1.5">
        <span className="text-3xl font-bold" style={{ color: value != null ? color : '#374d6c' }}>
          {value ?? '—'}
        </span>
        {value != null && unit && <span className="text-[#475569] text-sm mb-0.5">{unit}</span>}
      </div>
      {sublabel && <span className="text-[#475569] text-xs">{sublabel}</span>}
    </div>
  )
}

function ExTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-1">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
      </p>
      {d.ex_minutes != null && (
        <p className="text-white text-base font-semibold">{d.ex_minutes} min</p>
      )}
      {d.workout_count != null && (
        <p className="text-[#64748b] text-xs">
          {d.workout_count} session{d.workout_count !== 1 ? 's' : ''}
          {d.workout_minutes != null && ` · ${d.workout_minutes} min recorded`}
        </p>
      )}
      {d.hr_hard_minutes != null && (
        <p className="text-red-400 text-xs mt-0.5">{d.hr_hard_minutes} min HR zone</p>
      )}
    </div>
  )
}

function HrTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d?.hr_hard_minutes) return null
  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-1">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
      </p>
      <p className="text-white text-base font-semibold">{d.hr_hard_minutes} min</p>
      <p className="text-[#64748b] text-xs">HR &gt; 80% max</p>
    </div>
  )
}

const ZONES = [
  { key: 'hr_z1_min', label: 'Z1', pct: '50–60%', color: '#64748b' },
  { key: 'hr_z2_min', label: 'Z2', pct: '60–70%', color: '#3b82f6' },
  { key: 'hr_z3_min', label: 'Z3', pct: '70–80%', color: '#22c55e' },
  { key: 'hr_z4_min', label: 'Z4', pct: '80–90%', color: '#f97316' },
  { key: 'hr_z5_min', label: 'Z5', pct: '90%+',   color: '#ef4444' },
]

export default function ExerciseSection({ data, userId, onRefresh }) {
  const [showLog, setShowLog] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  // `exercise_minutes` is Apple's exercise-ring time (or a manually logged session);
  // `workout_minutes` is the summed duration of recorded workouts. They used to collide
  // on one metric name, so the chart flip-flopped between two incompatible quantities.
  // The chart stays on the ring figure and falls back to workout minutes only when there
  // is no ring figure at all for that day.
  const entries = (data?.entries ?? []).map(e => ({
    ...e,
    ex_minutes: e.exercise_minutes ?? e.workout_minutes ?? null,
  }))

  const cutoff7 = since(7)
  const last7   = entries.filter(e => new Date(e.date + 'T00:00:00') >= cutoff7)
  const last30  = entries.slice(-30)

  const workoutsThisWeek = last7.reduce((s, e) => s + (e.workout_count ?? 0), 0)
  const workoutMinsThisWeek = last7.reduce((s, e) => s + (e.workout_minutes ?? 0), 0)

  const today = new Date().toISOString().slice(0, 10)
  const todayEntry = entries.find(e => e.date === today)
  const todayMins = todayEntry?.ex_minutes ?? null

  // Per-zone avg over last 30 days (days that have any zone data)
  const zoneDays = last30.filter(e => ZONES.some(z => e[z.key] != null))
  const avgZoneMins = ZONES.map(z =>
    zoneDays.length
      ? Math.round(zoneDays.reduce((s, e) => s + (e[z.key] ?? 0), 0) / zoneDays.length)
      : null
  )
  const hasZoneData = zoneDays.length > 0
  const maxZoneAvg  = Math.max(1, ...avgZoneMins.filter(Boolean))

  const hasHrData = entries.some(e => e.hr_hard_minutes != null)
  const recent    = entries.slice(-60)

  return (
    <section id="exercise" className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-orange-500" />
          <h2 className="text-white text-xl font-semibold">Exercise</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLog(true)}
            className="flex items-center gap-2 bg-orange-600 hover:bg-orange-500 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span className="text-base leading-none">+</span>
            Log Session
          </button>
          <button onClick={() => setShowRaw(true)} className="font-mono text-[10px] text-[#243450] hover:text-[#475569] px-1 transition-colors" title="raw data">{'{}'}</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard
          label="Sessions This Week"
          value={workoutsThisWeek || null}
          unit="sessions"
          sublabel={`${last7.filter(e => e.workout_count).length} days active${workoutMinsThisWeek ? ` · ${Math.round(workoutMinsThisWeek)} min recorded` : ''}`}
          color="#f97316"
        />
        <StatCard
          label="Today"
          value={todayMins}
          unit="min"
          sublabel={todayMins != null ? (todayMins >= TARGET_MINUTES ? 'Goal reached' : `${TARGET_MINUTES - todayMins} min to goal`) : 'No data yet today'}
          color={todayMins ? exColor(todayMins) : '#f97316'}
        />

        {/* HR Zone breakdown card */}
        <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-5 flex flex-col gap-2">
          <span className="text-[#475569] text-xs font-medium uppercase tracking-wider">Avg Zone Min / Day</span>
          {hasZoneData ? (
            <div className="flex flex-col gap-1.5 mt-1">
              {ZONES.map((z, i) => (
                <div key={z.key} className="flex items-center gap-2">
                  <span className="text-[10px] font-mono w-5 shrink-0" style={{ color: z.color }}>{z.label}</span>
                  <div className="flex-1 h-1.5 bg-[#243450] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{ width: `${((avgZoneMins[i] ?? 0) / maxZoneAvg) * 100}%`, background: z.color, opacity: 0.8 }}
                    />
                  </div>
                  <span className="text-[10px] font-mono text-[#475569] w-8 text-right shrink-0">
                    {avgZoneMins[i] != null ? `${avgZoneMins[i]}m` : '—'}
                  </span>
                </div>
              ))}
              <p className="text-[#374d6c] text-[10px] mt-0.5">30-day avg · {zoneDays.length} workout days</p>
            </div>
          ) : (
            <p className="text-[#374d6c] text-xs mt-1">
              Set your max HR in your profile, then sync workouts.
            </p>
          )}
        </div>
      </div>

      {/* Exercise minutes bar chart */}
      <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-6 mb-4">
        <p className="text-white text-sm font-medium mb-4">Exercise Minutes / Day</p>
        {recent.filter(e => e.ex_minutes != null).length === 0 ? (
          <div className="flex items-center justify-center h-40 text-[#374d6c] text-sm">
            No exercise data — log a session or sync Apple Health
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={recent} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barSize={recent.length > 30 ? 5 : 9}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243450" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                tick={{ fill: '#475569', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#475569', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickCount={4}
                tickFormatter={v => `${v}m`}
              />
              <Tooltip content={<ExTooltip />} />
              <ReferenceLine y={TARGET_MINUTES} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.4} strokeWidth={1} />
              <Bar dataKey="ex_minutes" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {recent.map((e, i) => (
                  <Cell key={i} fill={exColor(e.ex_minutes ?? 0)} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {recent.filter(e => e.ex_minutes != null).length > 0 && (
          <div className="flex items-center gap-4 mt-3 text-[10px] text-[#475569]">
            <div className="flex items-center gap-1">
              <div className="w-4 h-px border-t border-dashed border-orange-500 opacity-50" />
              <span>Goal {TARGET_MINUTES} min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-orange-500 opacity-80" />
              <span>≥ {TARGET_MINUTES} min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-amber-500 opacity-80" />
              <span>Partial</span>
            </div>
          </div>
        )}
      </div>

      {/* HR zone stacked bar chart */}
      {hasZoneData && (
        <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-6">
          <p className="text-white text-sm font-medium mb-4">Heart Rate Zones / Day</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={recent} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barSize={recent.length > 30 ? 5 : 9}>
              <CartesianGrid strokeDasharray="3 3" stroke="#243450" vertical={false} />
              <XAxis
                dataKey="date"
                tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                tick={{ fill: '#475569', fontSize: 10 }}
                axisLine={false} tickLine={false} interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fill: '#475569', fontSize: 10 }}
                axisLine={false} tickLine={false} tickCount={4}
                tickFormatter={v => `${v}m`}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0]?.payload
                  const total = ZONES.reduce((s, z) => s + (d[z.key] ?? 0), 0)
                  if (!total) return null
                  return (
                    <div className="bg-[#131d2e] border border-[#243450] rounded-xl px-4 py-3 shadow-2xl">
                      <p className="text-[#64748b] text-xs mb-2">
                        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
                      </p>
                      {ZONES.slice().reverse().map(z => d[z.key] ? (
                        <p key={z.key} className="text-xs" style={{ color: z.color }}>
                          {z.label} ({z.pct}): {d[z.key]} min
                        </p>
                      ) : null)}
                    </div>
                  )
                }}
              />
              {ZONES.map((z, i) => (
                <Bar key={z.key} dataKey={z.key} stackId="zones" fill={z.color} fillOpacity={0.8}
                  radius={i === 4 ? [3, 3, 0, 0] : [0, 0, 0, 0]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-3 flex-wrap">
            {ZONES.map(z => (
              <div key={z.key} className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded-sm" style={{ background: z.color, opacity: 0.8 }} />
                <span className="text-[10px] text-[#475569]">{z.label} {z.pct}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showRaw && <RawDataModal label="exercise" data={data} onClose={() => setShowRaw(false)} />}
      {showLog && (
        <LogModal
          type="exercise"
          onClose={() => setShowLog(false)}
          onSave={async (entry) => {
            await api.logExercise(userId, entry)
            onRefresh()
            setShowLog(false)
          }}
        />
      )}
    </section>
  )
}
