import { useState, useMemo } from 'react'
import RawDataModal from './RawDataModal'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'

const OPTIMAL_MIN = 7
const OPTIMAL_MAX = 9

const TOTAL_GOAL = 8
const DEEP_GOAL  = 1.5
const REM_GOAL   = 1.5

const C_DEEP  = '#6366f1'
const C_REM   = '#c084fc'
const C_CORE  = '#38bdf8'
const C_TRACK = '#1a2540'

const HISTORY_RANGES = [
  { label: '10 Days', count: 10 },
  { label: '30 Days', count: 30 },
]

const BEDTIME_RANGES = [
  { label: '7D',  days: 7   },
  { label: '30D', days: 30  },
  { label: '1Y',  days: 365 },
]

// 8 PM = chart zero; times earlier in the day shift forward past midnight
const BASELINE = 20
function toChart(h) {
  if (h == null) return null
  return ((h - BASELINE + 24) % 24)
}
function chartToLabel(v) {
  const h = ((v + BASELINE) % 24)
  const hh = Math.floor(h)
  const period = hh >= 12 ? 'PM' : 'AM'
  const h12 = hh % 12 || 12
  return `${h12} ${period}`
}

function fmt(hours) {
  if (hours == null || hours === 0) return '—'
  const h = Math.floor(hours)
  const m = Math.round((hours - h) * 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function fmtTime(decimalHours) {
  if (decimalHours == null) return '—'
  const total = Math.round(decimalHours * 60)
  const h = Math.floor(total / 60) % 24
  const m = total % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function totalColor(hours) {
  if (!hours) return '#374d6c'
  if (hours >= OPTIMAL_MIN && hours <= OPTIMAL_MAX) return '#60a5fa'
  if (hours >= 6 && hours <= 10) return '#f59e0b'
  return '#f87171'
}

function Ring({ cx, cy, r, width, progress, color, trackColor = C_TRACK }) {
  const circ = 2 * Math.PI * r
  const offset = circ * (1 - Math.min(1, Math.max(0, progress ?? 0)))
  return (
    <g>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={trackColor} strokeWidth={width} />
      {(progress ?? 0) > 0.01 && (
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth={width}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform={`rotate(-90 ${cx} ${cy})`}
        />
      )}
    </g>
  )
}

function SleepRings({ entry, size = 220, showLabel = true }) {
  const cx = size / 2
  const cy = size / 2
  const rw  = Math.max(3, Math.round(size * 0.088))
  const gap = Math.max(2, Math.round(size * 0.028))

  const total = entry?.sleep_hours       ?? 0
  const deep  = entry?.deep_sleep_hours  ?? 0
  const rem   = entry?.rem_sleep_hours   ?? 0

  const r0 = size / 2 - 2          // thin outer achievement ring
  const r1 = r0 - 4 - rw / 2 - 2  // outer (total)
  const r2 = r1 - rw - gap          // middle (deep)
  const r3 = r2 - rw - gap          // inner (rem)

  const allMet = total >= TOTAL_GOAL && deep >= DEEP_GOAL && rem >= REM_GOAL

  const h = Math.floor(total)
  const m = Math.round((total - h) * 60)

  return (
    <svg width={size} height={size} style={{ overflow: 'visible', display: 'block' }}>
      <Ring cx={cx} cy={cy} r={r1} width={rw} progress={total / TOTAL_GOAL} color={totalColor(total)} />
      <Ring cx={cx} cy={cy} r={r2} width={rw} progress={deep / DEEP_GOAL}  color={C_DEEP} />
      <Ring cx={cx} cy={cy} r={r3} width={rw} progress={rem  / REM_GOAL}   color={C_REM} />

      {showLabel && entry && (
        <>
          <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize={size * 0.13} fontWeight="700" fontFamily="system-ui, sans-serif">
            {h}h{m > 0 ? ` ${m}m` : ''}
          </text>
          <text x={cx} y={cy + size * 0.075} textAnchor="middle" fill="#475569" fontSize={size * 0.055} fontFamily="system-ui, sans-serif">
            total sleep
          </text>
        </>
      )}
      {showLabel && !entry && (
        <text x={cx} y={cy + 5} textAnchor="middle" fill="#374d6c" fontSize={size * 0.07} fontFamily="system-ui, sans-serif">
          no data
        </text>
      )}
    </svg>
  )
}

function HistoryRing({ entry, selected, onClick }) {
  const SIZE = 64
  const date = entry ? new Date(entry.date + 'T00:00:00') : null
  const label = date
    ? date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    : '—'

  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 focus:outline-none group">
      <div
        className="rounded-full transition-all duration-200"
        style={selected
          ? { boxShadow: `0 0 0 2px ${totalColor(entry?.sleep_hours)}, 0 0 0 4px #131d2e` }
          : {}
        }
      >
        <SleepRings entry={entry} size={SIZE} showLabel={false} />
      </div>
      <span className={`text-[10px] tabular-nums transition-colors ${selected ? 'text-white' : 'text-[#374d6c] group-hover:text-[#475569]'}`}>
        {label}
      </span>
    </button>
  )
}

function StageRow({ label, value, total, goal, color }) {
  const pctOfNight = total ? Math.round((value ?? 0) / total * 100) : 0
  const pctOfGoal  = Math.min(100, Math.round((value ?? 0) / goal * 100))
  return (
    <div className="flex items-center gap-3">
      <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
      <div className="flex-1 min-w-0">
        <div className="flex justify-between text-xs mb-1.5">
          <span className="text-[#64748b]">{label}</span>
          <span className="text-white font-medium tabular-nums">{fmt(value)}</span>
        </div>
        <div className="h-1 rounded-full bg-[#1a2540] overflow-hidden">
          <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pctOfGoal}%`, background: color }} />
        </div>
      </div>
      <span className="text-[#374d6c] text-[10px] w-7 text-right tabular-nums flex-shrink-0">{pctOfNight}%</span>
    </div>
  )
}

function BedtimeTooltip({ active, payload }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d?.bedtime_raw) return null
  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-2">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
      </p>
      <div className="flex items-center gap-2 text-sm">
        <span>🌙</span>
        <span className="text-[#64748b]">Bedtime</span>
        <span className="text-white font-medium ml-auto pl-4">{fmtTime(d.bedtime_raw)}</span>
      </div>
    </div>
  )
}

export default function SleepSection({ data }) {
  const [showRaw, setShowRaw]           = useState(false)
  const [historyRange, setHistoryRange] = useState('10 Days')
  const [selectedDate, setSelectedDate] = useState(null)
  const [bedtimeRange, setBedtimeRange] = useState('30D')

  const entries   = data?.entries ?? []
  const withHours = entries.filter(e => e.sleep_hours != null)
  const latest    = withHours[withHours.length - 1]

  const selectedEntry = useMemo(() =>
    selectedDate ? withHours.find(e => e.date === selectedDate) ?? latest : latest
  , [selectedDate, withHours, latest])

  const historyCount   = HISTORY_RANGES.find(r => r.label === historyRange)?.count ?? 10
  const historyEntries = useMemo(() => withHours.slice(-historyCount).reverse(), [withHours, historyCount])

  const bedtimeDays = BEDTIME_RANGES.find(r => r.label === bedtimeRange)?.days ?? 30
  const bedtimeData = useMemo(() => {
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - bedtimeDays)
    const cutoffStr = cutoff.toISOString().slice(0, 10)
    return withHours
      .filter(e => e.date >= cutoffStr && e.bedtime != null)
      .map(e => ({ date: e.date, bedtime: toChart(e.bedtime), bedtime_raw: e.bedtime }))
      .reverse()
  }, [withHours, bedtimeDays])

  // Fixed scale: 9 PM (toChart(21)=1) to 1 AM (toChart(1)=5)
  const BT_MIN = 1    // 9 PM
  const BT_MAX = 5    // 1 AM

  return (
    <section id="sleep" className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-[#60a5fa]" />
          <h2 className="text-white text-xl font-semibold">Sleep</h2>
        </div>
        <button onClick={() => setShowRaw(true)} className="font-mono text-[10px] text-[#243450] hover:text-[#475569] px-1 transition-colors" title="raw data">{'{}'}</button>
      </div>

      {withHours.length === 0 ? (
        <div className="bg-[#131d2e] border border-[#243450] rounded-2xl flex items-center justify-center h-48 text-[#374d6c] text-sm">
          No sleep data yet — log a night or sync Apple Health
        </div>
      ) : (
        <>
          {/* Hero ring card */}
          <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-6 mb-4">
            <div className="flex flex-col sm:flex-row items-center gap-6 sm:gap-8">
              <div className="flex-shrink-0">
                <SleepRings entry={selectedEntry} size={210} />
              </div>

              <div className="flex-1 w-full">
                {selectedEntry && (
                  <p className="text-[#475569] text-xs mb-4">
                    {new Date(selectedEntry.date + 'T00:00:00').toLocaleDateString('en-US', {
                      weekday: 'long', month: 'long', day: 'numeric',
                    })}
                  </p>
                )}

                <div className="flex flex-col gap-3.5">
                  <StageRow
                    label="Total Sleep"
                    value={selectedEntry?.sleep_hours}
                    total={selectedEntry?.sleep_hours}
                    goal={TOTAL_GOAL}
                    color={totalColor(selectedEntry?.sleep_hours)}
                  />
                  <StageRow
                    label="Deep"
                    value={selectedEntry?.deep_sleep_hours}
                    total={selectedEntry?.sleep_hours}
                    goal={DEEP_GOAL}
                    color={C_DEEP}
                  />
                  <StageRow
                    label="REM"
                    value={selectedEntry?.rem_sleep_hours}
                    total={selectedEntry?.sleep_hours}
                    goal={REM_GOAL}
                    color={C_REM}
                  />
                  {(selectedEntry?.core_sleep_hours ?? 0) > 0 && (
                    <StageRow
                      label="Core"
                      value={selectedEntry?.core_sleep_hours}
                      total={selectedEntry?.sleep_hours}
                      goal={selectedEntry?.sleep_hours ?? 8}
                      color={C_CORE}
                    />
                  )}
                </div>

                {(selectedEntry?.bedtime != null || selectedEntry?.wake_time != null) && (
                  <div className="flex items-center gap-6 mt-1 pt-3.5 border-t border-[#1e2d45]">
                    <div className="flex items-center gap-2">
                      <span className="text-base">🌙</span>
                      <div>
                        <p className="text-[#64748b] text-[10px]">Bedtime</p>
                        <p className="text-white text-sm font-medium tabular-nums">{fmtTime(selectedEntry?.bedtime)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-base">☀️</span>
                      <div>
                        <p className="text-[#64748b] text-[10px]">Wake Up</p>
                        <p className="text-white text-sm font-medium tabular-nums">{fmtTime(selectedEntry?.wake_time)}</p>
                      </div>
                    </div>
                  </div>
                )}

                <div className="mt-3 text-[10px] text-[#374d6c]">
                  Goals: Total {TOTAL_GOAL}h · Deep {DEEP_GOAL}h · REM {REM_GOAL}h
                </div>
              </div>
            </div>
          </div>

          {/* History rings card */}
          <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-5">
              <p className="text-white text-sm font-medium">History</p>
              <div className="flex items-center gap-1 bg-[#0d1520] border border-[#243450] rounded-lg p-1">
                {HISTORY_RANGES.map(r => (
                  <button
                    key={r.label}
                    onClick={() => setHistoryRange(r.label)}
                    className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                      historyRange === r.label ? 'text-white shadow' : 'text-[#64748b] hover:text-[#94a3b8]'
                    }`}
                    style={historyRange === r.label ? { background: '#60a5fa' } : {}}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div className={`grid gap-x-2 gap-y-4 ${historyCount === 10 ? 'grid-cols-5' : 'grid-cols-6 sm:grid-cols-6'}`}>
              {historyEntries.map(e => (
                <HistoryRing
                  key={e.date}
                  entry={e}
                  selected={e.date === (selectedDate ?? latest?.date)}
                  onClick={() => setSelectedDate(e.date)}
                />
              ))}
            </div>

            {/* Ring legend */}
            <div className="flex items-center gap-4 mt-5 pt-4 border-t border-[#1e2d45] text-[10px] text-[#475569]">
              {[['Total', totalColor(7)], ['Deep', C_DEEP], ['REM', C_REM]].map(([l, c]) => (
                <div key={l} className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                  <span>{l}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Bedtime chart */}
          {bedtimeData.length > 0 && (
            <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-6 mt-4">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-white text-sm font-medium">🌙 Bedtime</p>
                  <p className="text-[#475569] text-xs mt-0.5">green ≤ 10:30 PM · red ≥ 11:30 PM</p>
                </div>
                <div className="flex items-center gap-1 bg-[#0d1520] border border-[#243450] rounded-lg p-1">
                  {BEDTIME_RANGES.map(r => (
                    <button
                      key={r.label}
                      onClick={() => setBedtimeRange(r.label)}
                      className={`px-3 py-1 rounded-md text-xs font-medium transition-all ${
                        bedtimeRange === r.label ? 'text-white shadow' : 'text-[#64748b] hover:text-[#94a3b8]'
                      }`}
                      style={bedtimeRange === r.label ? { background: '#60a5fa' } : {}}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>
              </div>

              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={bedtimeData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#243450" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={d => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    tick={{ fill: '#475569', fontSize: 10 }}
                    axisLine={false} tickLine={false} interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[BT_MIN, BT_MAX]}
                    ticks={[toChart(21), toChart(22), toChart(23), toChart(0), toChart(1)]}
                    tick={{ fill: '#475569', fontSize: 10 }}
                    axisLine={false} tickLine={false}
                    tickFormatter={chartToLabel}
                  />
                  <Tooltip content={<BedtimeTooltip />} />
                  {/* 10:30 PM = good threshold */}
                  <ReferenceLine y={toChart(22.5)} stroke="#34d399" strokeDasharray="4 3" strokeOpacity={0.5} strokeWidth={1} />
                  {/* 11:30 PM = late threshold */}
                  <ReferenceLine y={toChart(23.5)} stroke="#f87171" strokeDasharray="4 3" strokeOpacity={0.5} strokeWidth={1} />
                  <Line
                    type="monotone"
                    dataKey="bedtime"
                    stroke="none"
                    strokeWidth={0}
                    dot={(props) => {
                      const v = props.payload?.bedtime_raw
                      // Normalize: times past midnight (0–12h) add 24 so 12:35 AM = 24.58, not 0.58
                      const norm = v == null ? null : (v < 12 ? v + 24 : v)
                      const color = norm == null ? '#374d6c' : norm <= 22.5 ? '#34d399' : norm >= 23.5 ? '#f87171' : '#f59e0b'
                      return <circle key={props.key} cx={props.cx} cy={props.cy} r={5} fill={color} stroke="#0d1520" strokeWidth={1.5} />
                    }}
                    activeDot={{ r: 7 }}
                    connectNulls={false}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}

      {showRaw && <RawDataModal label="sleep" data={data} onClose={() => setShowRaw(false)} />}
    </section>
  )
}
