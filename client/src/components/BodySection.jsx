import { useState } from 'react'
import { api } from '../api'
import WeightChart from './WeightChart'
import LogModal from './LogModal'
import ImportPanel from './ImportPanel'
import RawDataModal from './RawDataModal'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'

function getLatest(entries, field) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i][field] != null) return entries[i][field]
  }
  return null
}

function getPrev(entries, field) {
  let found = 0
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i][field] != null) {
      found++
      if (found === 2) return entries[i][field]
    }
  }
  return null
}

function bmiCategory(bmi) {
  if (bmi < 18.5) return { label: 'Underweight', color: 'text-blue-400' }
  if (bmi < 25) return { label: 'Normal', color: 'text-emerald-400' }
  if (bmi < 30) return { label: 'Overweight', color: 'text-amber-400' }
  return { label: 'Obese', color: 'text-red-400' }
}

function viscFatCategory(vf) {
  if (vf <= 9) return { label: 'Normal', color: 'text-emerald-400' }
  if (vf <= 14) return { label: 'High', color: 'text-amber-400' }
  return { label: 'Very High', color: 'text-red-400' }
}

function smmCategory(smm) {
  // Male reference: >40% is good
  if (smm >= 44) return { label: 'Excellent', color: 'text-emerald-400' }
  if (smm >= 40) return { label: 'Good', color: 'text-emerald-400' }
  if (smm >= 36) return { label: 'Average', color: 'text-amber-400' }
  return { label: 'Below avg', color: 'text-red-400' }
}

function BodyTrendTooltip({ active, payload, unit }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-xl px-3 py-2 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-0.5">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
      </p>
      <p className="text-white text-base font-semibold">
        {payload[0].value} <span className="text-[#64748b] text-xs font-normal">{unit}</span>
      </p>
    </div>
  )
}

function BodyTrendChart({ title, dataKey, unit, color, entries }) {
  const filtered = entries.filter(e => e[dataKey] != null)
  const latest = filtered[filtered.length - 1]
  const prev   = filtered[filtered.length - 2]
  const delta  = latest && prev ? latest[dataKey] - prev[dataKey] : null
  const val    = latest?.[dataKey]

  const allVals = filtered.map(e => e[dataKey])
  const padding = allVals.length > 1 ? (Math.max(...allVals) - Math.min(...allVals)) * 0.3 || 2 : 5
  const yMin = allVals.length ? Math.floor(Math.min(...allVals) - padding) : 0
  const yMax = allVals.length ? Math.ceil(Math.max(...allVals) + padding) : 100

  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[#475569] text-xs font-medium uppercase tracking-wider">{title}</span>
      </div>
      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-white">{val ?? '—'}</span>
        {val != null && unit && <span className="text-[#475569] text-sm mb-0.5">{unit}</span>}
        {delta != null && delta !== 0 && (
          <span className={`text-xs mb-1 font-medium ml-1 ${delta < 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}
          </span>
        )}
      </div>
      {filtered.length < 2 ? (
        <div className="flex items-center justify-center h-20 text-[#374d6c] text-xs">No trend data yet</div>
      ) : (
        <ResponsiveContainer width="100%" height={80}>
          <LineChart data={filtered} margin={{ top: 4, right: 4, left: -30, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#243450" vertical={false} />
            <XAxis dataKey="date" hide />
            <YAxis domain={[yMin, yMax]} hide />
            <Tooltip content={<BodyTrendTooltip unit={unit} />} />
            <Line
              type="monotone"
              dataKey={dataKey}
              stroke={color}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, fill: color, stroke: '#0d1520', strokeWidth: 2 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  )
}

function MetricCard({ label, value, unit, category, delta, deltaLabel, sublabel, accent = '#7c3aed' }) {
  const isUp = delta > 0
  const isDown = delta < 0

  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-5 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-[#475569] text-xs font-medium uppercase tracking-wider">{label}</span>
        {category && (
          <span className={`text-xs font-medium ${category.color}`}>{category.label}</span>
        )}
      </div>

      <div className="flex items-end gap-2">
        <span className="text-3xl font-bold text-white">{value ?? '—'}</span>
        {unit && <span className="text-[#475569] text-sm mb-0.5">{unit}</span>}
        {delta != null && delta !== 0 && (
          <span className={`text-xs mb-1 font-medium ml-1 ${isDown ? 'text-emerald-400' : isUp ? 'text-amber-400' : 'text-[#475569]'}`}>
            {isDown ? '↓' : '↑'} {Math.abs(delta).toFixed(1)}
          </span>
        )}
      </div>

      {sublabel && (
        <p className="text-[#475569] text-xs">{sublabel}</p>
      )}

      {/* Mini progress bar for visceral fat */}
      {label === 'Visceral Fat' && value != null && (
        <div className="mt-1">
          <div className="flex justify-between text-[10px] text-[#475569] mb-1">
            <span>1</span><span>9</span><span>14</span><span>20</span>
          </div>
          <div className="h-1.5 rounded-full bg-[#243450] relative overflow-hidden">
            <div
              className="absolute left-0 top-0 h-full rounded-full transition-all"
              style={{
                width: `${(value / 20) * 100}%`,
                background: value <= 9 ? '#34d399' : value <= 14 ? '#fbbf24' : '#f87171'
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}

export default function BodySection({ data, events, userId, onRefresh }) {
  const [showLog, setShowLog]       = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showRaw, setShowRaw]       = useState(false)

  const entries = data?.entries ?? []

  const latestWeight = getLatest(entries, 'weight')
  const prevWeight = getPrev(entries, 'weight')
  const latestBMI = getLatest(entries, 'bmi')
  const prevBMI = getPrev(entries, 'bmi')
  const latestSMM = getLatest(entries, 'skeletal_muscle_mass')
  const prevSMM = getPrev(entries, 'skeletal_muscle_mass')
  const latestVF = getLatest(entries, 'visceral_fat')
  const prevVF = getPrev(entries, 'visceral_fat')

  return (
    <section id="body" className="mb-16">
      {/* Section header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-[#7c3aed]" />
          <h2 className="text-white text-xl font-semibold">Body</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLog(true)}
            className="flex items-center gap-2 bg-[#7c3aed] hover:bg-[#6d28d9] text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span className="text-base leading-none">+</span>
            Log Entry
          </button>
          <button
            onClick={() => setShowImport(true)}
            className="flex items-center gap-2 bg-[#131d2e] hover:bg-[#243450] border border-[#374d6c] text-[#94a3b8] text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span className="text-base leading-none">🍎</span>
            Sync
          </button>
          <button onClick={() => setShowRaw(true)} className="font-mono text-[10px] text-[#243450] hover:text-[#475569] px-1 transition-colors" title="raw data">{'{}'}</button>
        </div>
      </div>

      {/* Weight chart */}
      <WeightChart entries={entries} weightBySource={data?.weightBySource ?? {}} events={events?.entries ?? []} />

      {/* Trend charts: Weight · SMM · Body Fat Mass */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <BodyTrendChart title="Weight"          dataKey="weight"              unit="lbs" color="#a78bfa" entries={entries} />
        <BodyTrendChart title="Muscle Mass"     dataKey="skeletal_muscle_mass" unit="lbs" color="#34d399" entries={entries} />
        <BodyTrendChart title="Body Fat Mass"   dataKey="body_fat_mass"       unit="lbs" color="#f59e0b" entries={entries} />
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-4">
        <MetricCard
          label="BMI"
          value={latestBMI}
          unit=""
          category={latestBMI ? bmiCategory(latestBMI) : null}
          delta={latestBMI && prevBMI ? latestBMI - prevBMI : null}
          sublabel="Body mass index"
        />
        <MetricCard
          label="Skeletal Muscle"
          value={latestSMM}
          unit="%"
          category={latestSMM ? smmCategory(latestSMM) : null}
          delta={latestSMM && prevSMM ? latestSMM - prevSMM : null}
          sublabel="Muscle mass percentage"
        />
        <MetricCard
          label="Visceral Fat"
          value={latestVF}
          unit="level"
          category={latestVF ? viscFatCategory(latestVF) : null}
          delta={latestVF && prevVF ? latestVF - prevVF : null}
          sublabel="Scale 1–20"
        />
      </div>

      {showImport && (
        <ImportPanel
          userId={userId}
          onClose={() => {
            setShowImport(false)
            onRefresh()
          }}
        />
      )}
      {showLog && (
        <LogModal
          type="body"
          heightInches={data?.height_inches}
          onClose={() => setShowLog(false)}
          onSave={async (entry) => {
            await api.logBody(userId, entry)
            onRefresh()
            setShowLog(false)
          }}
        />
      )}
      {showRaw && <RawDataModal label="body" data={data} onClose={() => setShowRaw(false)} />}
    </section>
  )
}
