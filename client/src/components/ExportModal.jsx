import { useState } from 'react'

const SECTIONS = [
  { id: 'body',      label: 'Body',       defaultOn: true  },
  { id: 'sleep',     label: 'Sleep',      defaultOn: false },
  { id: 'exercise',  label: 'Exercise',   defaultOn: true  },
  { id: 'heartrate', label: 'Heart Rate', defaultOn: true  },
  { id: 'labs',      label: 'Labs',       defaultOn: true  },
  { id: 'dna',       label: 'DNA',        defaultOn: false },
  { id: 'events',    label: 'Events',     defaultOn: false },
]

function Checkbox({ checked }) {
  return (
    <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${
      checked ? 'bg-[#7c3aed] border-[#7c3aed]' : 'border-[#374d6c] bg-transparent'
    }`}>
      {checked && (
        <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </span>
  )
}

export default function ExportModal({ onClose, onPrint, onExportPng }) {
  const [selected, setSelected] = useState(
    Object.fromEntries(SECTIONS.map(s => [s.id, s.defaultOn]))
  )

  function toggle(id) {
    setSelected(prev => ({ ...prev, [id]: !prev[id] }))
  }

  const anySelected = Object.values(selected).some(Boolean)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(7,11,18,0.85)', backdropFilter: 'blur(6px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-[#131d2e] border border-[#243450] rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#243450]">
          <div>
            <h2 className="text-white font-semibold text-sm">Export</h2>
            <p className="text-[#475569] text-xs mt-0.5">Choose sections to include</p>
          </div>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] transition-colors text-lg leading-none">✕</button>
        </div>

        <div className="px-4 py-3 flex flex-col gap-1">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              onClick={() => toggle(s.id)}
              className="flex items-center gap-3 px-2 py-2.5 rounded-xl hover:bg-[#111827] transition-colors text-left w-full"
            >
              <Checkbox checked={selected[s.id]} />
              <span className={`text-sm transition-colors ${selected[s.id] ? 'text-[#cbd5e1]' : 'text-[#475569]'}`}>
                {s.label}
              </span>
            </button>
          ))}
        </div>

        <div className="px-6 py-4 border-t border-[#243450] flex flex-col gap-2">
          <button
            onClick={() => onExportPng(selected)}
            disabled={!anySelected}
            className="flex items-center justify-center gap-2 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium px-5 py-2.5 rounded-xl transition-colors w-full"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Export PNG
          </button>
          <button
            onClick={() => onPrint(selected)}
            disabled={!anySelected}
            className="flex items-center justify-center gap-2 bg-transparent hover:bg-[#111827] disabled:opacity-40 disabled:cursor-not-allowed text-[#94a3b8] text-sm font-medium px-5 py-2.5 rounded-xl border border-[#243450] transition-colors w-full"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Print / PDF
          </button>
          <button onClick={onClose} className="text-sm text-[#475569] hover:text-[#94a3b8] transition-colors text-center py-1">
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
