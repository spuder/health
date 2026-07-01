import { useState, useRef, useEffect } from 'react'
import RawDataModal from './RawDataModal'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'

const CHART_COLORS = ['#a78bfa', '#34d399', '#60a5fa', '#f59e0b', '#f87171', '#e879f9', '#2dd4bf', '#fb923c']
const SKIP_KEYS = new Set(['date', 'source', 'notes'])

const LAB_CATEGORIES = [
  {
    id: 'hormones',
    label: 'Hormone Balance',
    color: '#a78bfa',
    keys: [
      'testosterone', 'total_testosterone', 'free_testosterone', 'estrogen', 'estradiol', 'shbg',
      'dhea_s', 'cortisol', 'igf1', 'psa', 'tsh', 'free_t3', 'free_t4',
    ],
  },
  {
    id: 'heart',
    label: 'Heart Health',
    color: '#f87171',
    keys: [
      'total_cholesterol', 'ldl', 'hdl', 'triglycerides', 'apob',
      'remnant_cholesterol', 'triglycerides_hdl_ratio', 'total_cholesterol_hdl_ratio',
      'ldl_apob_ratio', 'homocysteine', 'crp', 'hscrp',
    ],
  },
  {
    id: 'fertility',
    label: 'Fertility',
    color: '#f472b6',
    keys: [
      'oxidative_stress_adduct', 'dna_fragmentation_index', 'high_dna_stainability',
      'semen_volume', 'semen_ph', 'sperm_progressive_motility', 'sperm_non_progressive_motility',
      'sperm_non_motile', 'total_sperm_motility', 'sperm_morphology', 'sperm_count_per_ml',
      'total_sperm_count', 'total_progressive_sperm_count',
    ],
  },
  {
    id: 'metabolic',
    label: 'Metabolic Efficiency',
    color: '#34d399',
    keys: [
      'glucose', 'hba1c', 'fructosamine',
      'vitamin_d', 'vitamin_b12', 'ferritin', 'iron', 'magnesium', 'calcium',
      'white_blood_cells', 'red_blood_cells', 'hemoglobin', 'hematocrit', 'platelets',
      'neutrophils', 'lymphocytes', 'monocytes', 'eosinophils', 'basophils',
      'sodium', 'potassium', 'creatinine', 'egfr', 'bun', 'uric_acid',
      'albumin', 'total_protein', 'globulin',
      'alt', 'ast', 'ggt', 'alkaline_phosphatase', 'total_bilirubin',
    ],
  },
]

const ALL_CATEGORIZED = new Set(LAB_CATEGORIES.flatMap(c => c.keys))

function fmtRange(low, high, unit) {
  const u = unit ? ` ${unit}` : ''
  if (low != null && high != null) return `${low}–${high}${u}`
  if (low != null) return `≥ ${low}${u}`
  if (high != null) return `≤ ${high}${u}`
  return ''
}

function toTitle(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function getMarkerStatus(key, entries, markers) {
  const filtered = entries.filter(e => e[key] != null)
  const val = filtered[filtered.length - 1]?.[key]
  if (val == null) return null

  const cfg = markers[key]
  if (!cfg) return null

  const { optimal_low, optimal_high, range_low, range_high } = cfg
  // A one-sided bound (e.g. "higher is better") counts as having a range
  const hasOptimal = optimal_low != null || optimal_high != null
  const hasNormal = range_low != null || range_high != null
  if (!hasOptimal && !hasNormal) return null

  const inOptimal = hasOptimal &&
    (optimal_low == null || val >= optimal_low) &&
    (optimal_high == null || val <= optimal_high)
  const inNormal = hasNormal &&
    (range_low == null || val >= range_low) &&
    (range_high == null || val <= range_high)

  if (inOptimal) return 'optimal'
  if (inNormal) return 'normal'
  return 'out'
}

function LabTableRow({ markerKey, markers, entries }) {
  const unit = markers[markerKey]?.unit ?? ''
  const filtered = entries.filter(e => e[markerKey] != null).sort((a, b) => a.date.localeCompare(b.date))
  if (filtered.length === 0) return null

  const last3 = filtered.slice(-3)
  const latest = last3[last3.length - 1]
  const prevEntry = last3[last3.length - 2]
  const pct = latest && prevEntry
    ? ((latest[markerKey] - prevEntry[markerKey]) / Math.abs(prevEntry[markerKey])) * 100
    : null

  const status = getMarkerStatus(markerKey, entries, markers)
  const isOut = status === 'out'

  return (
    <div className="flex items-center px-4 py-2.5 border-b border-[#161f30] last:border-0 hover:bg-[#0f1825]/50 transition-colors gap-3">
      <div className="flex-1 min-w-0">
        <span className="text-[#cbd5e1] text-sm">{toTitle(markerKey)}</span>
      </div>
      <div className="flex items-center gap-4 flex-shrink-0">
        {last3.map((entry, i) => {
          const v = entry[markerKey]
          const isLast = i === last3.length - 1
          return (
            <div key={entry.date} className="flex flex-col items-end gap-0.5">
              <span className={`text-sm font-medium tabular-nums ${isLast && isOut ? 'text-red-400' : isLast ? 'text-white' : 'text-[#475569]'}`}>
                {v}{unit && <span className="text-[#374d6c] text-xs ml-0.5">{unit}</span>}
              </span>
              <span className="text-[#374d6c] text-[10px] tabular-nums">
                {new Date(entry.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
          )
        })}
        <div className="flex items-center gap-1.5 w-16 justify-end">
          {status && (
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
              status === 'optimal' ? 'bg-emerald-400' :
              status === 'normal' ? 'bg-blue-400' : 'bg-red-400'
            }`} />
          )}
          {pct != null && (
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full border ${
              pct < 0 ? 'text-emerald-400 border-emerald-900 bg-emerald-950' : 'text-rose-400 border-rose-900 bg-rose-950'
            }`}>
              {pct > 0 ? '+' : ''}{pct.toFixed(0)}%
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

const SOURCE_LABEL = { apple_health: 'Apple Health', manual: 'Manual' }

function sourceLabel(source, date, reports) {
  if (source === 'pdf_import') {
    const report = reports.find(r => r.date === date)
    if (report?.filename) {
      const name = report.filename.replace(/\.[^.]+$/, '') // strip extension
      return name.length > 28 ? name.slice(0, 26) + '…' : name
    }
    return 'Lab Import'
  }
  return SOURCE_LABEL[source] ?? source ?? 'Unknown'
}

function CustomTooltip({ active, payload, unit, markerKey, reports }) {
  if (!active || !payload?.length) return null
  const d = payload[0]?.payload
  if (!d) return null
  const src = d.source ? sourceLabel(d.source, d.date, reports) : null
  return (
    <div className="bg-[#131d2e] border border-[#243450] rounded-xl px-4 py-3 shadow-2xl">
      <p className="text-[#64748b] text-xs mb-1">
        {new Date(d.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
      </p>
      <p className="text-white text-xl font-semibold">
        {d[markerKey]} <span className="text-[#64748b] text-sm font-normal">{unit}</span>
      </p>
      {src && <p className="text-[#475569] text-xs mt-1">{src}</p>}
      {d.notes && <p className="text-[#7c3aed] text-xs mt-1 italic">{d.notes}</p>}
    </div>
  )
}

const MARKER_INFO = {
  hematocrit: {
    summary: 'Blood thickness — the percentage of your blood that is red blood cells.',
    details: 'High hematocrit means thicker blood, which raises clot and stroke risk. If consistently above range, consider donating blood — it lowers hematocrit quickly and durably. Low hematocrit may indicate anemia or overhydration.',
  },
  apob: {
    summary: 'Counts the number of particles that can stick to artery walls.',
    details: 'Each LDL, VLDL, and lipoprotein(a) particle carries exactly one ApoB molecule. ApoB is a direct count of atherogenic particles — more particles means more chances for one to lodge in an artery wall and trigger plaque. It predicts cardiovascular risk better than LDL cholesterol alone, especially if your LDL looks normal but particle count is high.',
  },
  hscrp: {
    summary: 'High-sensitivity inflammation marker — detects low-grade chronic inflammation.',
    details: 'hsCRP is produced by the liver in response to inflammation anywhere in the body. Chronically elevated levels signal that your immune system is quietly active, which accelerates arterial plaque buildup and raises heart attack risk independently of cholesterol. Common drivers: poor sleep, visceral fat, processed food, gum disease, overtraining, or hidden infection. Below 1.0 mg/L is low risk; 1–3 is moderate; above 3 is high.',
  },
  // Add more markers here over time
}

function MarkerInfoPopup({ markerKey }) {
  const info = MARKER_INFO[markerKey]
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [open])

  if (!info) return null

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-5 h-5 rounded-full border border-[#374d6c] text-[#475569] hover:text-[#94a3b8] hover:border-[#475569] text-[10px] font-bold flex items-center justify-center transition-colors"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-64 bg-[#111826] border border-[#243450] rounded-xl p-4 shadow-2xl">
          <p className="text-white text-xs font-medium mb-2">{info.summary}</p>
          <p className="text-[#64748b] text-xs leading-relaxed">{info.details}</p>
        </div>
      )}
    </div>
  )
}

function LabChart({ title, markerKey, entries, unit, color, rangeHigh, rangeLow, optimalHigh, optimalLow, compact = false, reports = [] }) {
  const hasOptimal = optimalLow != null || optimalHigh != null
  const hasNormal = rangeLow != null || rangeHigh != null
  const filtered = entries.filter(e => e[markerKey] != null)
  const latest = filtered[filtered.length - 1]
  const prev = filtered[filtered.length - 2]
  const delta = latest && prev ? latest[markerKey] - prev[markerKey] : null

  const val = latest?.[markerKey]
  let status = null
  if (val != null && (hasOptimal || hasNormal)) {
    const inOptimal = hasOptimal &&
      (optimalLow == null || val >= optimalLow) &&
      (optimalHigh == null || val <= optimalHigh)
    const inNormal = hasNormal &&
      (rangeLow == null || val >= rangeLow) &&
      (rangeHigh == null || val <= rangeHigh)
    if (inOptimal) status = 'optimal'
    else if (inNormal) status = 'normal'
    else status = 'out'
  }

  const isOut = status === 'out'
  const chartColor = isOut ? '#f87171' : status === 'normal' ? '#f59e0b' : status === 'optimal' ? '#34d399' : color

  const allVals = filtered.map(e => e[markerKey])
  const refVals = [
    ...(hasOptimal ? [optimalLow, optimalHigh] : []),
    ...(hasNormal ? [rangeLow, rangeHigh] : []),
  ].filter(v => v != null)
  const dataMin = Math.min(...allVals, ...refVals, ...(allVals.length ? [] : [0]))
  const dataMax = Math.max(...allVals, ...refVals, ...(allVals.length ? [] : [100]))
  const padding = (dataMax - dataMin) * 0.25 || 10
  const yMin = Math.floor(dataMin - padding)
  const yMax = Math.ceil(dataMax + padding)

  return (
    <div className={`bg-[#131d2e] border rounded-2xl p-6 flex flex-col gap-4 ${isOut ? 'border-red-900' : 'border-[#243450]'
      }`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-white font-semibold text-base">{title}</h3>
          {unit && <p className="text-[#475569] text-xs mt-0.5">{unit}</p>}
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${status === 'optimal' ? 'border-emerald-800 bg-emerald-950 text-emerald-400' :
              status === 'normal' ? 'border-amber-800  bg-amber-950  text-amber-400' :
                'border-red-800    bg-red-950    text-red-400'
              }`}>
              {status === 'optimal' ? 'Optimal' : status === 'normal' ? 'Normal' : 'Out of range'}
            </span>
          )}
          <MarkerInfoPopup markerKey={markerKey} />
        </div>
      </div>

      <div className="flex items-end gap-2">
        <span className={`text-3xl font-bold ${isOut ? 'text-red-400' : 'text-white'}`}>{val ?? '—'}</span>
        {val != null && unit && <span className="text-[#475569] text-sm mb-0.5">{unit}</span>}
        {delta != null && delta !== 0 && (
          <span className={`text-xs mb-1 font-medium ml-1 ${delta < 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
            {delta > 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(0)}
          </span>
        )}
      </div>

      <ResponsiveContainer width="100%" height={160}>
        <LineChart data={filtered} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id={`norm-${markerKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.14} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0.06} />
            </linearGradient>
            <linearGradient id={`opt-${markerKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0.10} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="#243450" vertical={false} />

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

          <Tooltip content={<CustomTooltip unit={unit} markerKey={markerKey} reports={reports} />} />

          {hasNormal && (
            <ReferenceArea y1={rangeLow ?? yMin} y2={rangeHigh ?? yMax} fill={`url(#norm-${markerKey})`} stroke="none" />
          )}
          {hasOptimal && (
            <ReferenceArea y1={optimalLow ?? yMin} y2={optimalHigh ?? yMax} fill={`url(#opt-${markerKey})`} stroke="none" />
          )}

          {isOut && hasNormal && rangeHigh != null && (
            <ReferenceLine y={rangeHigh} stroke="#f87171" strokeDasharray="4 4" strokeOpacity={0.7} strokeWidth={1} />
          )}
          {isOut && hasNormal && rangeLow != null && rangeLow > 0 && (
            <ReferenceLine y={rangeLow} stroke="#f87171" strokeDasharray="4 4" strokeOpacity={0.7} strokeWidth={1} />
          )}

          <Line
            type="monotone"
            dataKey={markerKey}
            stroke={chartColor}
            strokeWidth={2.5}
            dot={{ fill: chartColor, strokeWidth: 0, r: compact ? 3 : 5 }}
            activeDot={{ r: compact ? 4 : 6, fill: chartColor, stroke: '#0d1520', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {(hasOptimal || hasNormal) && (
        <div className="flex items-center gap-4 text-[10px] text-[#475569]">
          {hasOptimal && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-emerald-400" style={{ opacity: 0.5 }} />
              <span>Optimal {fmtRange(optimalLow, optimalHigh, unit)}</span>
            </div>
          )}
          {hasNormal && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-blue-400" style={{ opacity: 0.4 }} />
              <span>Normal {fmtRange(rangeLow, rangeHigh, unit)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_FILTERS = [
  { id: 'optimal', label: 'Optimal', activeClass: 'border-emerald-700 bg-emerald-950 text-emerald-400' },
  { id: 'normal', label: 'Normal', activeClass: 'border-amber-700   bg-amber-950   text-amber-400' },
  { id: 'out', label: 'Out of Range', activeClass: 'border-red-700     bg-red-950     text-red-400' },
]

export default function LabsSection({ data, reports = [] }) {
  const [activeFilters, setActiveFilters] = useState(new Set(['optimal', 'normal', 'out']))
  const [searchQuery, setSearchQuery] = useState('')
  const [showRaw, setShowRaw] = useState(false)
  const [layout, setLayout] = useState('card')
  const entries = data?.entries ?? []
  const markers = data?.markers ?? {}

  const knownKeys = Object.keys(markers)
  const allKeysInData = [...new Set(entries.flatMap(e => Object.keys(e).filter(k => !SKIP_KEYS.has(k))))]
  const unknownKeys = allKeysInData.filter(k => !knownKeys.includes(k)).sort()
  const allMarkerKeys = [...knownKeys.filter(k => allKeysInData.includes(k)), ...unknownKeys]

  const allDates = [...new Set(entries.map(e => e.date))].sort()
  const labDates = allDates.filter(d => {
    const entry = entries.find(e => e.date === d)
    return entry && [...ALL_CATEGORIZED].some(k => entry[k] != null)
  })
  const colDates = labDates.slice(-3)

  // Stable color index by position in allMarkerKeys so colors don't shift when filtering
  const colorIndex = Object.fromEntries(allMarkerKeys.map((k, i) => [k, i]))

  function toggleFilter(id) {
    setActiveFilters(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const normalizedSearch = searchQuery.trim().toLowerCase().replace(/\s+/g, '_')

  function isVisible(key) {
    if (normalizedSearch && !key.toLowerCase().includes(normalizedSearch) && !toTitle(key).toLowerCase().includes(searchQuery.trim().toLowerCase())) return false
    const status = getMarkerStatus(key, entries, markers)
    // Markers with no range config have no status — always show them
    if (status === null) return true
    return activeFilters.has(status)
  }

  const STATUS_ORDER = { out: 0, normal: 1, optimal: 2 }
  function sortByStatus(keys) {
    return [...keys].sort((a, b) => {
      const sa = STATUS_ORDER[getMarkerStatus(a, entries, markers)] ?? 3
      const sb = STATUS_ORDER[getMarkerStatus(b, entries, markers)] ?? 3
      return sa - sb
    })
  }

  // Build grouped sections: each LAB_CATEGORY, then "Other" for uncategorized keys
  const sections = LAB_CATEGORIES.map(cat => ({
    label: cat.label,
    color: cat.color,
    keys: sortByStatus(cat.keys.filter(k => allMarkerKeys.includes(k) && isVisible(k))),
  })).filter(s => s.keys.length > 0)

  const otherKeys = sortByStatus(allMarkerKeys.filter(k => !ALL_CATEGORIZED.has(k) && isVisible(k)))
  if (otherKeys.length) sections.push({ label: 'Other', color: '#64748b', keys: otherKeys, compact: true })

  return (
    <section id="labs" className="mb-16">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-emerald-500" />
          <h2 className="text-white text-xl font-semibold">Labs</h2>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center bg-[#0d1520] border border-[#243450] rounded-lg overflow-hidden">
            <button
              onClick={() => setLayout('table')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${layout === 'table' ? 'bg-[#1e2d45] text-white' : 'text-[#475569] hover:text-[#94a3b8]'}`}
            >
              Table
            </button>
            <button
              onClick={() => setLayout('card')}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${layout === 'card' ? 'bg-[#1e2d45] text-white' : 'text-[#475569] hover:text-[#94a3b8]'}`}
            >
              Card
            </button>
          </div>
          <button onClick={() => setShowRaw(true)} className="font-mono text-[10px] text-[#243450] hover:text-[#475569] px-1 transition-colors" title="raw data">{'{}'}</button>
        </div>
      </div>

      {/* Search + status filter toggles */}
      {allMarkerKeys.length > 0 && (
        <div className="flex flex-col gap-3 mb-6">
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#475569] pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="11" cy="11" r="7" strokeWidth="2" />
              <line x1="16.5" y1="16.5" x2="22" y2="22" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search markers…"
              className="w-full bg-[#111827] border border-[#243450] hover:border-[#374d6c] focus:border-[#4f6080] text-[#cbd5e1] placeholder-[#475569] text-sm rounded-xl pl-10 pr-10 py-2.5 outline-none transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-[#475569] hover:text-[#94a3b8] transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            {STATUS_FILTERS.map(f => {
              const active = activeFilters.has(f.id)
              return (
                <button
                  key={f.id}
                  onClick={() => toggleFilter(f.id)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${active
                    ? f.activeClass
                    : 'border-[#243450] bg-transparent text-[#475569] hover:text-[#94a3b8] hover:border-[#374d6c]'
                    }`}
                >
                  {f.label}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {allMarkerKeys.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-[#374d6c] text-sm">
          No lab data yet — upload a PDF to get started
        </div>
      ) : sections.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-[#374d6c] text-sm">
          {searchQuery ? `No markers match "${searchQuery}"` : 'No markers match the selected filters'}
        </div>
      ) : layout === 'card' ? (
        <div className="flex flex-col gap-8">
          {sections.map(section => (
            <div key={section.label}>
              <div className="flex items-center gap-2.5 mb-4">
                <div className="w-1 h-4 rounded-full" style={{ backgroundColor: section.color }} />
                <h3 className="text-[#94a3b8] text-sm font-medium">{section.label}</h3>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {section.keys.map(key => (
                  <LabChart
                    key={key}
                    title={toTitle(key)}
                    markerKey={key}
                    entries={entries}
                    unit={markers[key]?.unit ?? ''}
                    color={CHART_COLORS[colorIndex[key] % CHART_COLORS.length]}
                    optimalLow={markers[key]?.optimal_low}
                    optimalHigh={markers[key]?.optimal_high}
                    rangeLow={markers[key]?.range_low}
                    rangeHigh={markers[key]?.range_high}
                    compact={section.compact ?? false}
                    reports={reports}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {sections.map(section => (
            <div key={section.label}>
              <div className="flex items-center gap-2.5 mb-3">
                <div className="w-1 h-4 rounded-full" style={{ backgroundColor: section.color }} />
                <h3 className="text-[#94a3b8] text-sm font-medium">{section.label}</h3>
              </div>
              <div className="bg-[#131d2e] border border-[#243450] rounded-2xl overflow-hidden">
                {section.keys.map(key => (
                  <LabTableRow key={key} markerKey={key} markers={markers} entries={entries} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
      {showRaw && <RawDataModal label="labs" data={{ blood: data }} onClose={() => setShowRaw(false)} />}
    </section>
  )
}
