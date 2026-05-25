import { useState, useRef } from 'react'
import { api } from '../api'
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer,
} from 'recharts'
import LogModal from './LogModal'

const CHART_COLORS = ['#a78bfa', '#34d399', '#60a5fa', '#f59e0b', '#f87171', '#e879f9', '#2dd4bf', '#fb923c']
const SKIP_KEYS = new Set(['date', 'source', 'notes'])

function toTitle(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
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

function LabChart({ title, markerKey, entries, unit, color, rangeHigh, rangeLow, optimalHigh, optimalLow }) {
  const hasOptimal = optimalLow != null && optimalHigh != null
  const hasNormal  = rangeLow  != null && rangeHigh  != null
  const filtered = entries.filter(e => e[markerKey] != null)
  const latest = filtered[filtered.length - 1]
  const prev   = filtered[filtered.length - 2]
  const delta  = latest && prev ? latest[markerKey] - prev[markerKey] : null

  const val = latest?.[markerKey]
  let status = null
  if (val != null && hasOptimal) {
    if (val >= optimalLow && val <= optimalHigh) status = 'optimal'
    else if (hasNormal && val >= rangeLow && val <= rangeHigh) status = 'normal'
    else status = 'out'
  }

  const isOut = status === 'out'
  const chartColor = isOut ? '#f87171' : status === 'normal' ? '#f59e0b' : color

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
        {status && (
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${
            status === 'optimal' ? 'border-emerald-800 bg-emerald-950 text-emerald-400' :
            status === 'normal'  ? 'border-amber-800  bg-amber-950  text-amber-400'  :
                                   'border-red-800    bg-red-950    text-red-400'
          }`}>
            {status === 'optimal' ? 'Optimal' : status === 'normal' ? 'Normal' : 'Out of range'}
          </span>
        )}
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
            <linearGradient id={`opt-${markerKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={0.15} />
              <stop offset="100%" stopColor="#34d399" stopOpacity={0.04} />
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

          {/* Green optimal zone */}
          {hasOptimal && (
            <ReferenceArea y1={optimalLow} y2={optimalHigh} fill={`url(#opt-${markerKey})`} stroke="none" />
          )}

          {/* Red boundary lines at the normal (healthy) limits */}
          {hasNormal && rangeHigh != null && (
            <ReferenceLine y={rangeHigh} stroke="#f87171" strokeDasharray="4 4" strokeOpacity={0.5} strokeWidth={1} />
          )}
          {hasNormal && rangeLow != null && rangeLow > 0 && (
            <ReferenceLine y={rangeLow} stroke="#f87171" strokeDasharray="4 4" strokeOpacity={0.5} strokeWidth={1} />
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

      {hasOptimal && (
        <div className="flex items-center gap-3 text-[10px] text-[#475569]">
          <div className="flex items-center gap-1">
            <div className="w-6 h-2 rounded-sm bg-emerald-500 opacity-30" />
            <span>Optimal {optimalLow}–{optimalHigh}{unit ? ` ${unit}` : ''}</span>
          </div>
          {hasNormal && (
            <div className="flex items-center gap-1">
              <div className="w-4 h-px border-t border-dashed border-red-400 opacity-60" />
              <span>Limit {rangeHigh}{unit ? ` ${unit}` : ''}</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function LabsSection({ data, userId, onRefresh }) {
  const [showLog, setShowLog] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadResult, setUploadResult] = useState(null)
  const fileInputRef = useRef(null)
  const entries = data?.entries ?? []
  const markers = data?.markers ?? {}

  // Known markers (have reference ranges) first, then remaining alphabetically
  const knownKeys = Object.keys(markers)
  const allKeysInData = [...new Set(entries.flatMap(e => Object.keys(e).filter(k => !SKIP_KEYS.has(k))))]
  const unknownKeys = allKeysInData.filter(k => !knownKeys.includes(k)).sort()
  const allMarkerKeys = [...knownKeys.filter(k => allKeysInData.includes(k)), ...unknownKeys]

  async function handlePdfUpload(e) {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''

    setUploading(true)
    setUploadResult(null)
    try {
      const result = await api.importLabsPdf(userId, file)
      setUploadResult({ ok: true, count: result.count, markers_found: result.markers_found, date: result.date })
      onRefresh()
    } catch (err) {
      setUploadResult({ error: err.message })
    } finally {
      setUploading(false)
    }
  }

  return (
    <section id="labs" className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-emerald-500" />
          <h2 className="text-white text-xl font-semibold">Labs</h2>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handlePdfUpload} />
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
              Imported {uploadResult.count} metric{uploadResult.count !== 1 ? 's' : ''} from {uploadResult.date}
              {' — '}{uploadResult.markers_found.join(', ')}
            </span>
          )}
          <button onClick={() => setUploadResult(null)} className="opacity-50 hover:opacity-100 shrink-0">✕</button>
        </div>
      )}

      {allMarkerKeys.length === 0 ? (
        <div className="flex items-center justify-center py-16 text-[#2d3d58] text-sm">
          No lab data yet — upload a PDF to get started
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {allMarkerKeys.map((key, i) => (
            <LabChart
              key={key}
              title={toTitle(key)}
              markerKey={key}
              entries={entries}
              unit={markers[key]?.unit ?? ''}
              color={CHART_COLORS[i % CHART_COLORS.length]}
              optimalLow={markers[key]?.optimal_low}
              optimalHigh={markers[key]?.optimal_high}
              rangeLow={markers[key]?.range_low}
              rangeHigh={markers[key]?.range_high}
            />
          ))}
        </div>
      )}

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
