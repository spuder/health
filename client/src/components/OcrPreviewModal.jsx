import { useState } from 'react'

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

export default function OcrPreviewModal({ parsed, onConfirm, onCancel, saving }) {
  const metrics = parsed?.metrics ?? {}
  const keys = Object.keys(metrics)
  const [checked, setChecked] = useState(() => Object.fromEntries(keys.map(k => [k, true])))

  const selectedCount = Object.values(checked).filter(Boolean).length

  function toggle(key) {
    setChecked(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function toggleAll() {
    const allOn = keys.every(k => checked[k])
    setChecked(Object.fromEntries(keys.map(k => [k, !allOn])))
  }

  function handleConfirm() {
    const selectedMetrics = Object.fromEntries(
      keys.filter(k => checked[k]).map(k => [k, metrics[k]])
    )
    onConfirm({ ...parsed, metrics: selectedMetrics })
  }

  const allChecked = keys.every(k => checked[k])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(7,11,18,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onCancel() }}
    >
      <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl shadow-2xl w-full max-w-sm flex flex-col max-h-[85vh]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#1d2a3e] shrink-0">
          <div>
            <h2 className="text-white font-semibold text-sm">Review OCR Results</h2>
            <p className="text-[#475569] text-xs mt-0.5">
              {SOURCE_LABEL[parsed?.source_type] ?? 'Lab Report'}
              {parsed?.date && ` · ${parsed.date}`}
            </p>
          </div>
          <button onClick={onCancel} className="text-[#475569] hover:text-[#94a3b8] transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Select all */}
        <div className="px-5 py-2.5 border-b border-[#1d2a3e] shrink-0">
          <button
            onClick={toggleAll}
            className="flex items-center gap-2 text-xs text-[#475569] hover:text-[#94a3b8] transition-colors"
          >
            <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
              allChecked ? 'bg-[#7c3aed] border-[#7c3aed]' : 'border-[#2d3d58] bg-transparent'
            }`}>
              {allChecked && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
            </span>
            {allChecked ? 'Deselect all' : 'Select all'}
          </button>
        </div>

        {/* Metric list */}
        <div className="overflow-y-auto flex-1 px-5 py-3 flex flex-col gap-0.5">
          {keys.map(key => {
            const on = checked[key]
            const unit = UNITS[key] ?? ''
            return (
              <button
                key={key}
                onClick={() => toggle(key)}
                className="flex items-center gap-3 w-full py-2.5 px-2 rounded-xl hover:bg-[#111827] transition-colors text-left"
              >
                <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
                  on ? 'bg-[#7c3aed] border-[#7c3aed]' : 'border-[#2d3d58] bg-transparent'
                }`}>
                  {on && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" /></svg>}
                </span>
                <span className={`flex-1 text-sm transition-colors ${on ? 'text-[#cbd5e1]' : 'text-[#2d3d58]'}`}>
                  {toLabel(key)}
                </span>
                <span className={`text-sm font-mono transition-colors ${on ? 'text-white' : 'text-[#2d3d58]'}`}>
                  {metrics[key]}{unit && <span className="text-[#475569] text-xs ml-1">{unit}</span>}
                </span>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-[#1d2a3e] flex gap-2 shrink-0">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl text-sm font-medium text-[#475569] hover:text-[#94a3b8] border border-[#1d2a3e] hover:border-[#2d3d58] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={selectedCount === 0 || saving}
            className="flex-1 py-2 rounded-xl text-sm font-medium bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            {saving ? 'Saving…' : `Import ${selectedCount} metric${selectedCount !== 1 ? 's' : ''}`}
          </button>
        </div>

      </div>
    </div>
  )
}
