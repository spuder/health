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
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl p-5 flex flex-col gap-2">
      <span className="text-[#475569] text-xs font-medium uppercase tracking-wider">{label}</span>
      <div className="flex items-end gap-1.5">
        <span className="text-3xl font-bold" style={{ color: value != null ? color : '#2d3d58' }}>
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
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-1">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
      </p>
      {d.exercise_minutes != null && (
        <p className="text-white text-base font-semibold">{d.exercise_minutes} min</p>
      )}
      {d.workout_count != null && (
        <p className="text-[#64748b] text-xs">{d.workout_count} session{d.workout_count !== 1 ? 's' : ''}</p>
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
    <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-1">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric' })}
      </p>
      <p className="text-white text-base font-semibold">{d.hr_hard_minutes} min</p>
      <p className="text-[#64748b] text-xs">HR &gt; 80% max</p>
    </div>
  )
}

export default function ExerciseSection({ data, userId, onRefresh }) {
  const [showLog, setShowLog] = useState(false)
  const [showRaw, setShowRaw] = useState(false)
  const entries = data?.entries ?? []

  const cutoff7  = since(7)
  const last7    = entries.filter(e => new Date(e.date + 'T00:00:00') >= cutoff7)
  const last30   = entries.slice(-30)

  // Workouts this week = sum of workout_count in last 7 days
  const workoutsThisWeek = last7.reduce((s, e) => s + (e.workout_count ?? 0), 0)

  // Avg exercise minutes over last 30 days (only days with data)
  const ex30 = last30.filter(e => e.exercise_minutes != null)
  const avgExMins = ex30.length
    ? Math.round(ex30.reduce((s, e) => s + e.exercise_minutes, 0) / ex30.length)
    : null

  // Avg HR hard minutes over last 30 days
  const hr30 = last30.filter(e => e.hr_hard_minutes != null)
  const avgHrMins = hr30.length
    ? Math.round(hr30.reduce((s, e) => s + e.hr_hard_minutes, 0) / hr30.length)
    : null

  const hasHrData = entries.some(e => e.hr_hard_minutes != null)
  const recent = entries.slice(-60)

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
          <button onClick={() => setShowRaw(true)} className="font-mono text-[10px] text-[#1d2a3e] hover:text-[#475569] px-1 transition-colors" title="raw data">{'{}'}</button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
        <StatCard
          label="Sessions This Week"
          value={workoutsThisWeek || null}
          unit="sessions"
          sublabel={`${last7.filter(e => e.workout_count).length} days active`}
          color="#f97316"
        />
        <StatCard
          label="Avg Min / Day"
          value={avgExMins}
          unit="min"
          sublabel="Last 30 days"
          color={avgExMins ? exColor(avgExMins) : '#f97316'}
        />
        <StatCard
          label="Avg HR Zone / Day"
          value={avgHrMins}
          unit="min"
          sublabel="Min HR > 80% max"
          color={avgHrMins ? hrColor(avgHrMins) : '#ef4444'}
        />
      </div>

      {/* Exercise minutes bar chart */}
      <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl p-6 mb-4">
        <p className="text-white text-sm font-medium mb-4">Exercise Minutes / Day</p>
        {recent.filter(e => e.exercise_minutes != null).length === 0 ? (
          <div className="flex items-center justify-center h-40 text-[#2d3d58] text-sm">
            No exercise data — log a session or sync Apple Health
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={recent} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barSize={recent.length > 30 ? 5 : 9}>
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
                tick={{ fill: '#475569', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickCount={4}
                tickFormatter={v => `${v}m`}
              />
              <Tooltip content={<ExTooltip />} />
              <ReferenceLine y={TARGET_MINUTES} stroke="#f97316" strokeDasharray="4 4" strokeOpacity={0.4} strokeWidth={1} />
              <Bar dataKey="exercise_minutes" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {recent.map((e, i) => (
                  <Cell key={i} fill={exColor(e.exercise_minutes ?? 0)} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
        {recent.filter(e => e.exercise_minutes != null).length > 0 && (
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

      {/* HR zone bar chart — only shown when data exists */}
      {hasHrData && (
        <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl p-6">
          <p className="text-white text-sm font-medium mb-4">Min / Day HR &gt; 80% Max</p>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={recent.filter(e => e.hr_hard_minutes != null)} margin={{ top: 4, right: 8, left: -20, bottom: 0 }} barSize={9}>
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
                tick={{ fill: '#475569', fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickCount={4}
                tickFormatter={v => `${v}m`}
              />
              <Tooltip content={<HrTooltip />} />
              <ReferenceLine y={TARGET_HR_MINS} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.4} strokeWidth={1} />
              <Bar dataKey="hr_hard_minutes" radius={[3, 3, 0, 0]} isAnimationActive={false}>
                {recent.filter(e => e.hr_hard_minutes != null).map((e, i) => (
                  <Cell key={i} fill={hrColor(e.hr_hard_minutes ?? 0)} fillOpacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
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
