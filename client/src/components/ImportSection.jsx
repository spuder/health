import { useState, useRef } from 'react'
import { api } from '../api'

const UNITS = {
  weight: 'lbs', skeletal_muscle_mass: 'lbs', body_fat_mass: 'lbs', lean_mass: 'lbs',
  body_fat: '%', bmi: '', visceral_fat: 'level', bmr: 'kcal', total_body_water: 'L',
  testosterone: 'ng/dL', total_testosterone: 'ng/dL', free_testosterone: 'pg/mL',
  estradiol: 'pg/mL', shbg: 'nmol/L', dhea_s: 'µg/dL', cortisol: 'µg/dL',
  igf1: 'ng/mL', psa: 'ng/mL', tsh: 'uIU/mL', free_t3: 'pg/mL', free_t4: 'ng/dL',
  total_cholesterol: 'mg/dL', ldl: 'mg/dL', hdl: 'mg/dL', triglycerides: 'mg/dL',
  glucose: 'mg/dL', hba1c: '%', vitamin_d: 'ng/mL', vitamin_b12: 'pg/mL',
  ferritin: 'ng/mL', crp: 'mg/L', hscrp: 'mg/L', homocysteine: 'µmol/L',
  hemoglobin: 'g/dL', hematocrit: '%', creatinine: 'mg/dL', egfr: 'mL/min',
  alt: 'U/L', ast: 'U/L', ggt: 'U/L',
}

const SOURCE_LABEL = { blood_panel: 'Blood Panel', inbody: 'InBody Scan', other: 'Lab Report' }

function toLabel(key) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
    .replace(/\bBmi\b/, 'BMI').replace(/\bHrv\b/, 'HRV').replace(/\bHdl\b/, 'HDL')
    .replace(/\bLdl\b/, 'LDL').replace(/\bBmr\b/, 'BMR').replace(/\bPsa\b/, 'PSA')
    .replace(/\bTsh\b/, 'TSH').replace(/\bCrp\b/, 'CRP').replace(/\bGgt\b/, 'GGT')
    .replace(/\bAlt\b/, 'ALT').replace(/\bAst\b/, 'AST').replace(/\bBun\b/, 'BUN')
    .replace(/\bEgfr\b/, 'eGFR').replace(/\bHba1c\b/, 'HbA1c')
}

export default function ImportSection({ userId, onRefresh, reports = [] }) {
  const [phase, setPhase] = useState('idle') // idle | uploading | preview | done
  const [dragging, setDragging] = useState(false)
  const [fileName, setFileName] = useState(null)
  const [parsed, setParsed] = useState(null)
  const [checked, setChecked] = useState({})
  const [error, setError] = useState(null)
  const [importCount, setImportCount] = useState(0)
  const [fileHash, setFileHash] = useState(null)
  const [reportsOpen, setReportsOpen] = useState(false)
  const fileInputRef = useRef(null)

  function resetToIdle() {
    setPhase('idle')
    setFileName(null)
    setParsed(null)
    setChecked({})
    setError(null)
    setFileHash(null)
  }

  async function processFile(file) {
    if (!file || (!file.name.toLowerCase().endsWith('.pdf') && !file.name.toLowerCase().endsWith('.csv') && !file.name.toLowerCase().endsWith('.png'))) {
      setError('Please upload a PDF, CSV, or PNG file.')
      return
    }
    setError(null)
    setFileName(file.name)
    setPhase('uploading')
    try {
      const result = await api.importLabsPdf(userId, file)
      if (result.debug) {
        const keys = Object.keys(result.parsed?.metrics ?? {})
        setChecked(Object.fromEntries(keys.map(k => [k, true])))
        setParsed(result.parsed)
        setFileHash(result.file_hash ?? null)
        setPhase('preview')
      }
    } catch (err) {
      setError(err.message)
      setPhase('idle')
    }
  }

  function handleFileInput(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) processFile(file)
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) processFile(file)
  }

  function toggleMetric(key) {
    setChecked(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function toggleAll() {
    const keys = Object.keys(parsed?.metrics ?? {})
    const allOn = keys.every(k => checked[k])
    setChecked(Object.fromEntries(keys.map(k => [k, !allOn])))
  }

  async function handleConfirm() {
    const keys = Object.keys(parsed?.metrics ?? {})
    const selectedMetrics = Object.fromEntries(keys.filter(k => checked[k]).map(k => [k, parsed.metrics[k]]))
    setPhase('uploading')
    try {
      const result = await api.confirmLabsImport(userId, { ...parsed, metrics: selectedMetrics, file_hash: fileHash })
      setImportCount(result.count)
      setPhase('done')
      onRefresh?.()
      setTimeout(resetToIdle, 1000)
    } catch (err) {
      setError(err.message)
      setPhase('preview')
    }
  }

  const metricKeys = Object.keys(parsed?.metrics ?? {})
  const selectedCount = metricKeys.filter(k => checked[k]).length
  const allChecked = metricKeys.length > 0 && metricKeys.every(k => checked[k])

  return (
    <section id="import" className="mb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-1 h-6 rounded-full bg-violet-500" />
        <h2 className="text-white text-xl font-semibold">Import</h2>
      </div>

      {/* Idle — drop zone */}
      {phase === 'idle' && (
        <div
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-2xl border-2 border-dashed transition-colors flex flex-col items-center justify-center py-20 gap-4 select-none
            ${dragging
              ? 'border-violet-500 bg-violet-500/5'
              : 'border-[#243450] bg-[#131d2e] hover:border-[#374d6c] hover:bg-[#111827]'
            }`}
        >
          <input ref={fileInputRef} type="file" accept=".pdf,.PDF,.csv,.CSV,.png,.PNG" className="hidden" onChange={handleFileInput} />
          <div className="w-12 h-12 rounded-xl bg-[#243450] flex items-center justify-center">
            <svg className="w-6 h-6 text-[#475569]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-[#94a3b8] text-sm font-medium">Drop a PDF or CSV here or click to browse</p>
            <p className="text-[#374d6c] text-xs mt-1">InBody scans · Blood panels · Lab reports · Screenshots</p>
          </div>
        </div>
      )}

      {/* Uploading / processing */}
      {phase === 'uploading' && (
        <div className="rounded-2xl border border-[#243450] bg-[#131d2e] flex flex-col items-center justify-center py-20 gap-4">
          <svg className="w-8 h-8 text-violet-400 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          <div className="text-center">
            <p className="text-[#94a3b8] text-sm font-medium">Reading with AI…</p>
            {fileName && <p className="text-[#374d6c] text-xs mt-1">{fileName}</p>}
          </div>
        </div>
      )}

      {/* Preview — metric toggles */}
      {phase === 'preview' && parsed && (
        <div className="rounded-2xl border border-[#243450] bg-[#131d2e] overflow-hidden">
          {/* Preview header */}
          <div className="px-6 py-4 border-b border-[#243450] flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-semibold">Review detected metrics</p>
              <p className="text-[#475569] text-xs mt-0.5">
                {SOURCE_LABEL[parsed.source_type] ?? 'Lab Report'}
                {parsed.date && ` · ${parsed.date}`}
                {fileName && ` · ${fileName}`}
              </p>
            </div>
            <button
              onClick={resetToIdle}
              className="text-[#475569] hover:text-[#94a3b8] text-lg leading-none transition-colors"
            >✕</button>
          </div>

          {/* Select all row */}
          <div className="px-6 py-3 border-b border-[#243450]">
            <button onClick={toggleAll} className="flex items-center gap-2.5 text-xs text-[#475569] hover:text-[#94a3b8] transition-colors">
              <Checkbox checked={allChecked} />
              {allChecked ? 'Deselect all' : 'Select all'}
            </button>
          </div>

          {/* Metric rows */}
          <div className="divide-y divide-[#131d2e]">
            {metricKeys.map(key => {
              const on = checked[key]
              const unit = UNITS[key] ?? ''
              return (
                <button
                  key={key}
                  onClick={() => toggleMetric(key)}
                  className="w-full flex items-center gap-4 px-6 py-3.5 hover:bg-[#111827] transition-colors text-left"
                >
                  <Checkbox checked={on} />
                  <span className={`flex-1 text-sm transition-colors ${on ? 'text-[#cbd5e1]' : 'text-[#374d6c]'}`}>
                    {toLabel(key)}
                  </span>
                  <span className={`text-sm font-mono tabular-nums transition-colors ${on ? 'text-white' : 'text-[#374d6c]'}`}>
                    {parsed.metrics[key]}
                    {unit && <span className={`text-xs ml-1 ${on ? 'text-[#475569]' : 'text-[#243450]'}`}>{unit}</span>}
                  </span>
                </button>
              )
            })}
          </div>

          {/* Footer actions */}
          <div className="px-6 py-4 border-t border-[#243450] flex items-center justify-between gap-3">
            <button
              onClick={resetToIdle}
              className="text-sm text-[#475569] hover:text-[#94a3b8] transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirm}
              disabled={selectedCount === 0}
              className="flex items-center gap-2 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2 rounded-xl transition-colors"
            >
              Import {selectedCount} metric{selectedCount !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {phase === 'done' && (
        <div className="rounded-2xl border border-emerald-800 bg-emerald-950 flex flex-col items-center justify-center py-20 gap-4">
          <div className="w-12 h-12 rounded-full bg-emerald-900 flex items-center justify-center">
            <svg className="w-6 h-6 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-emerald-300 text-sm font-medium">{importCount} metric{importCount !== 1 ? 's' : ''} imported</p>
            <p className="text-emerald-700 text-xs mt-1">{parsed?.date}</p>
          </div>
          <button
            onClick={resetToIdle}
            className="text-xs text-emerald-600 hover:text-emerald-400 transition-colors mt-1"
          >
            Import another
          </button>
        </div>
      )}

      {/* Error banner */}
      {error && (
        <div className="mt-4 px-4 py-3 rounded-xl bg-red-950 border border-red-800 text-red-300 text-sm flex items-center justify-between gap-3">
          <span>⚠ {error}</span>
          <button onClick={() => setError(null)} className="opacity-50 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Past reports */}
      {reports.length > 0 && (
        <div className="mt-6">
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
                <div key={r.id} className="flex items-center justify-between bg-[#131d2e] border border-[#243450] rounded-xl px-4 py-3">
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
                    <span className="text-[#374d6c] text-xs">{r.markers.length} markers</span>
                  </div>
                  <a
                    href={api.labReportPdfUrl(userId, r.id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[#475569] hover:text-white text-xs font-medium px-3 py-1.5 rounded-lg border border-[#243450] hover:border-[#374d6c] transition-colors"
                  >
                    View PDF
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function Checkbox({ checked }) {
  return (
    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-[#7c3aed] border-[#7c3aed]' : 'border-[#374d6c] bg-transparent'
      }`}>
      {checked && (
        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  )
}
