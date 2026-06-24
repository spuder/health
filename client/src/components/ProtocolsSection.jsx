import { useState, useRef, useEffect, useMemo } from 'react'
import { api } from '../api'

const PALETTE = ['#7c3aed', '#34d399', '#60a5fa', '#f59e0b', '#f87171', '#e879f9', '#2dd4bf', '#fb923c', '#a78bfa']

function currentYM() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

function nextYM(ym) {
  const [y, m] = ym.split('-').map(Number)
  const d = new Date(y, m)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function getVisibleMonths(protocols) {
  const cur = currentYM()
  const next = nextYM(cur)
  const withData = new Set(protocols.map(p => p.month))
  const all = new Set([...withData, cur, next])
  return [...all].sort()
}

function pickColor(existing) {
  const used = new Set(existing.map(p => p.color))
  return PALETTE.find(c => !used.has(c)) ?? PALETTE[existing.length % PALETTE.length]
}

// ── Inline editable text ────────────────────────────────────────
function Editable({ value, onSave, className, placeholder }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const ref = useRef()

  useEffect(() => { if (editing) ref.current?.focus() }, [editing])

  function commit() {
    const v = draft.trim()
    if (v && v !== value) onSave(v)
    else setDraft(value)
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={ref}
        value={draft}
        placeholder={placeholder}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={`bg-transparent border-b border-[#475569] outline-none ${className}`}
        style={{ width: '100%' }}
      />
    )
  }

  return (
    <span
      onClick={() => { setDraft(value); setEditing(true) }}
      className={`cursor-text ${className}`}
    >
      {value}
    </span>
  )
}

// ── Color picker popover ─────────────────────────────────────────
function ColorDot({ color, onChange }) {
  const [open, setOpen] = useState(false)
  const ref = useRef()

  useEffect(() => {
    if (!open) return
    function onDown(e) { if (!ref.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="w-5 h-5 rounded-full border-2 border-[#243450] transition-transform hover:scale-110"
        style={{ backgroundColor: color }}
      />
      {open && (
        <div className="absolute right-0 top-7 z-20 bg-[#111826] border border-[#243450] rounded-xl p-2 flex flex-wrap gap-1.5 shadow-2xl" style={{ width: 116 }}>
          {PALETTE.map(c => (
            <button
              key={c}
              onClick={() => { onChange(c); setOpen(false) }}
              className="w-5 h-5 rounded-full border-2 transition-transform hover:scale-110"
              style={{ backgroundColor: c, borderColor: c === color ? '#fff' : 'transparent' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Sub-protocol item ────────────────────────────────────────────
function SubItem({ sub, userId, onRefresh }) {
  async function save(name) {
    await api.updateSubProtocol(userId, sub.id, { name })
    onRefresh()
  }
  async function del() {
    await api.deleteSubProtocol(userId, sub.id)
    onRefresh()
  }
  return (
    <div className="flex items-start gap-1.5 group/sub pl-1">
      <span className="text-[#374d6c] text-xs mt-0.5 shrink-0">·</span>
      <Editable value={sub.name} onSave={save} className="text-[#64748b] text-sm flex-1 leading-relaxed" />
      <button
        onClick={del}
        className="opacity-0 group-hover/sub:opacity-100 text-[#374d6c] hover:text-red-400 text-xs transition-all shrink-0 leading-none"
      >×</button>
    </div>
  )
}

// ── Inline add-sub input ─────────────────────────────────────────
function AddSubInput({ onAdd, onCancel }) {
  const [val, setVal] = useState('')
  const ref = useRef()
  useEffect(() => ref.current?.focus(), [])

  function commit() {
    const v = val.trim()
    if (v) onAdd(v); else onCancel()
  }

  return (
    <div className="flex items-center gap-1.5 pl-1 mt-0.5">
      <span className="text-[#374d6c] text-xs shrink-0">·</span>
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { if (!val.trim()) onCancel() }}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="add item…"
        className="flex-1 bg-transparent border-b border-[#374d6c] outline-none text-[#64748b] text-sm py-0.5 placeholder-[#374d6c] min-w-0"
      />
    </div>
  )
}

// ── Protocol row ─────────────────────────────────────────────────
function ProtocolRow({ protocol, userId, onRefresh }) {
  const [addingSub, setAddingSub] = useState(false)

  async function saveName(name) {
    await api.updateProtocol(userId, protocol.id, { name, color: protocol.color })
    onRefresh()
  }
  async function saveColor(color) {
    await api.updateProtocol(userId, protocol.id, { name: protocol.name, color })
    onRefresh()
  }
  async function del() {
    await api.deleteProtocol(userId, protocol.id)
    onRefresh()
  }
  async function addSub(name) {
    await api.addSubProtocol(userId, protocol.id, { name })
    setAddingSub(false)
    onRefresh()
  }

  return (
    <div className="group/row py-3 border-b border-[#131d2e] last:border-0">
      <div className="flex items-center gap-3">
        <span className="flex-1 min-w-0">
          <Editable value={protocol.name} onSave={saveName} className="text-[#cbd5e1] text-base font-medium" />
        </span>
        <ColorDot color={protocol.color} onChange={saveColor} />
        <button
          onClick={del}
          className="opacity-0 group-hover/row:opacity-100 text-[#374d6c] hover:text-red-400 text-sm transition-all leading-none"
        >×</button>
      </div>

      {/* Sub-items */}
      {(protocol.sub_protocols.length > 0 || addingSub) && (
        <div className="mt-1.5 flex flex-col gap-0.5">
          {protocol.sub_protocols.map(s => (
            <SubItem key={s.id} sub={s} userId={userId} onRefresh={onRefresh} />
          ))}
          {addingSub && <AddSubInput onAdd={addSub} onCancel={() => setAddingSub(false)} />}
        </div>
      )}

      {!addingSub && (
        <button
          onClick={() => setAddingSub(true)}
          className="mt-1.5 text-xs text-[#243450] hover:text-[#374d6c] transition-colors pl-1"
        >
          + add item
        </button>
      )}
    </div>
  )
}

// ── Inline new-protocol input (bottom of card) ───────────────────
function AddProtocolInput({ onAdd, onCancel }) {
  const [val, setVal] = useState('')
  const ref = useRef()
  useEffect(() => ref.current?.focus(), [])

  function commit() {
    const v = val.trim()
    if (v) onAdd(v); else onCancel()
  }

  return (
    <div className="border border-[#374d6c] rounded-xl px-4 py-2.5 mt-2">
      <input
        ref={ref}
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { if (!val.trim()) onCancel() }}
        onKeyDown={e => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder="Protocol name…"
        className="w-full bg-transparent outline-none text-white text-sm placeholder-[#374d6c]"
      />
    </div>
  )
}

// ── Month card ───────────────────────────────────────────────────
function MonthCard({ month, protocols, isCurrent, userId, onRefresh }) {
  const [adding, setAdding] = useState(false)

  async function handleAdd(name) {
    const color = pickColor(protocols)
    await api.addProtocol(userId, { month, name, color })
    setAdding(false)
    onRefresh()
  }

  return (
    <div
      data-month-card
      className="shrink-0 flex flex-col"
      style={{ width: 'min(calc(100vw - 64px), 340px)', scrollSnapAlign: 'center' }}
    >
      {/* Month label */}
      <p className={`text-sm font-semibold text-center mb-3 ${isCurrent ? 'text-[#94a3b8]' : 'text-[#475569]'}`}>
        {monthLabel(month)}
      </p>

      {/* Card body */}
      <div className={`flex-1 rounded-2xl border px-4 py-4 flex flex-col ${
        isCurrent
          ? 'border-[#374d6c] bg-[#131d2e]'
          : 'border-[#243450] bg-[#131d2e]'
      }`}>
        {protocols.length > 0 ? (
          <div className="flex flex-col">
            {protocols.map(p => (
              <ProtocolRow key={p.id} protocol={p} userId={userId} onRefresh={onRefresh} />
            ))}
          </div>
        ) : (
          <p className="text-[#374d6c] text-sm text-center py-6">No protocols</p>
        )}

        {adding && <AddProtocolInput onAdd={handleAdd} onCancel={() => setAdding(false)} />}

        <div className="flex-1" />

        {/* Large circular add button */}
        <div className="flex justify-center mt-6">
          <button
            onClick={() => setAdding(true)}
            className={`w-12 h-12 rounded-full border-2 flex items-center justify-center transition-colors ${
              isCurrent
                ? 'border-[#374d6c] hover:border-[#7c3aed] text-[#475569] hover:text-[#7c3aed]'
                : 'border-[#243450] text-[#374d6c] hover:border-[#374d6c] hover:text-[#475569]'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Section ──────────────────────────────────────────────────────
export default function ProtocolsSection({ data = [], userId, onRefresh }) {
  const scrollRef = useRef()
  const hasScrolled = useRef(false)
  const cur = currentYM()
  const months = useMemo(() => getVisibleMonths(data), [data])

  const byMonth = useMemo(() => {
    const map = {}
    for (const p of data) {
      if (!map[p.month]) map[p.month] = []
      map[p.month].push(p)
    }
    return map
  }, [data])

  // Center the current month once on first load
  useEffect(() => {
    if (hasScrolled.current || !scrollRef.current || !months.length) return
    const cards = scrollRef.current.querySelectorAll('[data-month-card]')
    const idx = months.indexOf(cur)
    if (cards[idx]) {
      cards[idx].scrollIntoView({ behavior: 'instant', inline: 'center', block: 'nearest' })
      hasScrolled.current = true
    }
  }, [months.join(',')])

  return (
    <section id="protocols" className="mb-16">
      {/* Standard section header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-1 h-6 rounded-full bg-violet-400" />
        <h2 className="text-white text-xl font-semibold">Protocols</h2>
      </div>

      {/* Horizontal scroll */}
      <div className="relative">
        <div
          ref={scrollRef}
          className="flex overflow-x-auto pb-2"
          style={{
            scrollSnapType: 'x mandatory',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            gap: 16,
            paddingLeft: 'max(8px, calc(50% - 170px))',
            paddingRight: 'max(8px, calc(50% - 170px))',
          }}
        >
          {months.map(month => (
            <MonthCard
              key={month}
              month={month}
              protocols={byMonth[month] ?? []}
              isCurrent={month === cur}
              userId={userId}
              onRefresh={onRefresh}
            />
          ))}
        </div>
        {/* Side fade hints */}
        <div className="pointer-events-none absolute left-0 top-0 bottom-2 w-6 sm:w-16 bg-gradient-to-r from-[#0d1520] to-transparent" />
        <div className="pointer-events-none absolute right-0 top-0 bottom-2 w-6 sm:w-16 bg-gradient-to-l from-[#0d1520] to-transparent" />
      </div>
    </section>
  )
}
