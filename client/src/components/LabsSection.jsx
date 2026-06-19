import { useState, useRef, useEffect } from 'react'
import { api } from '../api'
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
  const hasNormal  = range_low  != null || range_high  != null
  if (!hasOptimal && !hasNormal) return null

  const inOptimal = hasOptimal &&
    (optimal_low  == null || val >= optimal_low) &&
    (optimal_high == null || val <= optimal_high)
  const inNormal = hasNormal &&
    (range_low  == null || val >= range_low) &&
    (range_high == null || val <= range_high)

  if (inOptimal) return 'optimal'
  if (inNormal)  return 'normal'
  return 'out'
}

function CustomTooltip({ active, payload, unit, markerKey }) {
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
        className="w-5 h-5 rounded-full border border-[#2d3d58] text-[#475569] hover:text-[#94a3b8] hover:border-[#475569] text-[10px] font-bold flex items-center justify-center transition-colors"
      >
        ?
      </button>
      {open && (
        <div className="absolute right-0 top-7 z-20 w-64 bg-[#0a0f1a] border border-[#1d2a3e] rounded-xl p-4 shadow-2xl">
          <p className="text-white text-xs font-medium mb-2">{info.summary}</p>
          <p className="text-[#64748b] text-xs leading-relaxed">{info.details}</p>
        </div>
      )}
    </div>
  )
}

function LabChart({ title, markerKey, entries, unit, color, rangeHigh, rangeLow, optimalHigh, optimalLow }) {
  const hasOptimal = optimalLow != null || optimalHigh != null
  const hasNormal  = rangeLow  != null || rangeHigh  != null
  const filtered = entries.filter(e => e[markerKey] != null)
  const latest = filtered[filtered.length - 1]
  const prev   = filtered[filtered.length - 2]
  const delta  = latest && prev ? latest[markerKey] - prev[markerKey] : null

  const val = latest?.[markerKey]
  let status = null
  if (val != null && (hasOptimal || hasNormal)) {
    const inOptimal = hasOptimal &&
      (optimalLow  == null || val >= optimalLow) &&
      (optimalHigh == null || val <= optimalHigh)
    const inNormal = hasNormal &&
      (rangeLow  == null || val >= rangeLow) &&
      (rangeHigh == null || val <= rangeHigh)
    if (inOptimal)     status = 'optimal'
    else if (inNormal) status = 'normal'
    else               status = 'out'
  }

  const isOut = status === 'out'
  const chartColor = isOut ? '#f87171' : status === 'normal' ? '#f59e0b' : status === 'optimal' ? '#34d399' : color

  const allVals = filtered.map(e => e[markerKey])
  const refVals = [
    ...(hasOptimal ? [optimalLow, optimalHigh] : []),
    ...(hasNormal  ? [rangeLow,  rangeHigh]  : []),
  ]
  const dataMin = Math.min(...allVals, ...refVals, ...(allVals.length ? [] : [0]))
  const dataMax = Math.max(...allVals, ...refVals, ...(allVals.length ? [] : [100]))
  const padding = (dataMax - dataMin) * 0.25 || 10
  const yMin = Math.floor(dataMin - padding)
  const yMax = Math.ceil(dataMax + padding)

  return (
    <div className={`bg-[#0d1422] border rounded-2xl p-6 flex flex-col gap-4 ${
      isOut ? 'border-red-900' : 'border-[#1d2a3e]'
    }`}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-white font-semibold text-base">{title}</h3>
          {unit && <p className="text-[#475569] text-xs mt-0.5">{unit}</p>}
        </div>
        <div className="flex items-center gap-2">
          {status && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
              status === 'optimal' ? 'border-emerald-800 bg-emerald-950 text-emerald-400' :
              status === 'normal'  ? 'border-amber-800  bg-amber-950  text-amber-400'  :
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
            dot={{ fill: chartColor, strokeWidth: 0, r: 5 }}
            activeDot={{ r: 6, fill: chartColor, stroke: '#070b12', strokeWidth: 2 }}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>

      {(hasOptimal || hasNormal) && (
        <div className="flex items-center gap-4 text-[10px] text-[#475569]">
          {hasOptimal && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-emerald-400" style={{ opacity: 0.5 }} />
              <span>Optimal {optimalLow}–{optimalHigh}{unit ? ` ${unit}` : ''}</span>
            </div>
          )}
          {hasNormal && (
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm bg-blue-400" style={{ opacity: 0.4 }} />
              <span>Normal {rangeLow}–{rangeHigh}{unit ? ` ${unit}` : ''}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const STATUS_FILTERS = [
  { id: 'optimal', label: 'Optimal',      activeClass: 'border-emerald-700 bg-emerald-950 text-emerald-400' },
  { id: 'normal',  label: 'Normal',       activeClass: 'border-amber-700   bg-amber-950   text-amber-400'   },
  { id: 'out',     label: 'Out of Range', activeClass: 'border-red-700     bg-red-950     text-red-400'     },
]

const SOURCE_LABEL = { blood_panel: 'Blood Panel', inbody: 'InBody Scan', other: 'Lab Report' }

export default function LabsSection({ data, reports = [], userId, onRefresh }) {
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const [activeFilters, setActiveFilters] = useState(new Set(['optimal', 'normal', 'out']))
  const [reportsOpen, setReportsOpen] = useState(false)
  const fileInputRef = useRef(null)
  const entries = data?.entries ?? []
  const markers = data?.markers ?? {}

  const knownKeys = Object.keys(markers)
  const allKeysInData = [...new Set(entries.flatMap(e => Object.keys(e).filter(k => !SKIP_KEYS.has(k))))]
  const unknownKeys = allKeysInData.filter(k => !knownKeys.includes(k)).sort()
  const allMarkerKeys = [...knownKeys.filter(k => allKeysInData.includes(k)), ...unknownKeys]

  // Stable color index by position in allMarkerKeys so colors don't shift when filtering
  const colorIndex = Object.fromEntries(allMarkerKeys.map((k, i) => [k, i]))

  function toggleFilter(id) {
    setActiveFilters(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function isVisible(key) {
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
  if (otherKeys.length) sections.push({ label: 'Other', color: '#64748b', keys: otherKeys })

  async function handlePdfUpload(e) {
    const files = [...(e.target.files ?? [])]
    if (!files.length) return
    e.target.value = ''

    setUploading(true)
    setUploadResult(null)
    let totalCount = 0
    const allMarkers = []
    const errors = []
    for (const file of files) {
      try {
        const result = await api.importLabsPdf(userId, file)
        totalCount += result.count ?? 0
        allMarkers.push(...(result.markers_found ?? []))
      } catch (err) {
        const msg = err.message?.startsWith('Duplicate:') ? `${file.name} — already imported` : `${file.name}: ${err.message}`
        errors.push(msg)
      }
    }
    if (errors.length && totalCount === 0) {
      setUploadResult({ error: errors.join('; ') })
    } else {
      setUploadResult({ ok: true, count: totalCount, markers_found: [...new Set(allMarkers)], files: files.length, errors })
      onRefresh()
    }
    setUploading(false)
  }

  return (
    <section id="labs" className="mb-16">
      {/* Header row */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-emerald-500" />
          <h2 className="text-white text-xl font-semibold">Labs</h2>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf" multiple className="hidden" onChange={handlePdfUpload} />
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
            className="flex items-center gap-2 bg-[#0d1422] hover:bg-[#141d2e] disabled:opacity-50 disabled:cursor-not-allowed border border-[#1d2a3e] hover:border-[#2d3d58] text-[#94a3b8] hover:text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            {uploading ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Parsing…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload PDF
              </>
            )}
          </button>
        </div>
      </div>

      {/* Status filter toggles */}
      {allMarkerKeys.length > 0 && (
        <div className="flex items-center gap-2 mb-6">
          {STATUS_FILTERS.map(f => {
            const active = activeFilters.has(f.id)
            return (
              <button
                key={f.id}
                onClick={() => toggleFilter(f.id)}
                className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${
                  active
                    ? f.activeClass
                    : 'border-[#1d2a3e] bg-transparent text-[#475569] hover:text-[#94a3b8] hover:border-[#2d3d58]'
                }`}
              >
                {f.label}
              </button>
            )
          })}
        </div>
      )}

      {uploadResult && (
        <div className={`mb-4 px-4 py-3 rounded-xl border text-sm flex items-start justify-between gap-3 ${
          uploadResult.error
            ? 'bg-red-950 border-red-800 text-red-300'
            : 'bg-emerald-950 border-emerald-800 text-emerald-300'
        }`}>
          {uploadResult.error ? (
            <span>⚠ {uploadResult.error}</span>
          ) : (
            <span>
              Imported {uploadResult.count} metric{uploadResult.count !== 1 ? 's' : ''} across {uploadResult.files} file{uploadResult.files !== 1 ? 's' : ''}
              {uploadResult.markers_found.length > 0 && ` — ${uploadResult.markers_found.join(', ')}`}
              {uploadResult.errors?.length > 0 && ` (${uploadResult.errors.length} failed)`}
            </span>
          )}
          <button onClick={() => setUploadResult(null)} className="opacity-50 hover:opacity-100 shrink-0">✕</button>
        </div>
      )}

      {/* Past reports — collapsible */}
      {reports.length > 0 && (
        <div className="mb-6">
          <button
            onClick={() => setReportsOpen(v => !v)}
            className="flex items-center gap-2 text-[#475569] hover:text-[#94a3b8] text-xs font-medium mb-2 transition-colors"
          >
            <svg
              className={`w-3 h-3 transition-transform ${reportsOpen ? 'rotate-90' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {reports.length} report{reports.length !== 1 ? 's' : ''}
          </button>
          {reportsOpen && (
            <div className="flex flex-col gap-2">
              {reports.map(r => (
                <div key={r.id} className="flex items-center justify-between bg-[#0d1422] border border-[#1d2a3e] rounded-xl px-4 py-3">
                  <div className="flex items-center gap-3">
                    <svg className="w-4 h-4 text-[#475569] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    <div>
                      <span className="text-white text-sm font-medium">
                        {new Date(r.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                      </span>
                      <span className="text-[#475569] text-xs ml-2">{SOURCE_LABEL[r.source_type] ?? r.source_type}</span>
                    </div>
                    <span className="text-[#2d3d58] text-xs">{r.markers.length} markers</span>
                  </div>
                  <a
                    href={api.labReportPdfUrl(userId, r.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#475569] hover:text-white text-xs font-medium px-3 py-1.5 rounded-lg border border-[#1d2a3e] hover:border-[#2d3d58] transition-colors"
                  >
                    View PDF
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {allMarkerKeys.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-[#2d3d58] text-sm">
          No lab data yet — upload a PDF to get started
        </div>
      ) : sections.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-[#2d3d58] text-sm">
          No markers match the selected filters
        </div>
      ) : (
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
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

    </section>
  )
}
