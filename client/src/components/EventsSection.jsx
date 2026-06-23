import { useState } from 'react'
import { api } from '../api'
import LogModal from './LogModal'
import RawDataModal from './RawDataModal'

const EVENT_TYPES = {
  doctor_visit: {
    label: 'Doctor Visit',
    icon: '🩺',
    color: 'border-amber-600 bg-amber-950',
    badge: 'text-amber-400 bg-amber-950 border-amber-700',
    dot: 'bg-amber-400',
  },
  blood_draw: {
    label: 'Blood Draw',
    icon: '🩸',
    color: 'border-emerald-700 bg-emerald-950',
    badge: 'text-emerald-400 bg-emerald-950 border-emerald-700',
    dot: 'bg-emerald-400',
  },
}

function EventCard({ event, onDelete }) {
  const cfg = EVENT_TYPES[event.type] ?? {
    label: event.type,
    icon: '📌',
    color: 'border-[#374d6c]',
    badge: 'text-[#94a3b8] bg-[#1a2540] border-[#374d6c]',
    dot: 'bg-[#475569]',
  }

  const date = new Date(event.date + 'T00:00:00')
  const dateStr = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const monthYear = date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })

  return (
    <div className="flex gap-4 group">
      {/* Timeline dot + line */}
      <div className="flex flex-col items-center pt-1">
        <div className={`w-3 h-3 rounded-full flex-shrink-0 ring-2 ring-[#0d1520] ${cfg.dot}`} />
        <div className="w-px flex-1 bg-[#243450] mt-2" />
      </div>

      {/* Card */}
      <div className={`flex-1 border rounded-xl p-4 mb-4 ${cfg.color} transition-all`}>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-lg">{cfg.icon}</span>
            <div>
              <p className="text-white font-medium text-sm">{event.label}</p>
              <p className="text-[#475569] text-xs mt-0.5">{dateStr}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${cfg.badge}`}>
              {cfg.label}
            </span>
            <button
              onClick={() => onDelete()}
              className="text-[#374d6c] hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 text-sm"
              title="Delete event"
            >
              ✕
            </button>
          </div>
        </div>

        {event.notes && (
          <p className="text-[#64748b] text-xs mt-3 leading-relaxed border-t border-[#243450] pt-3">
            {event.notes}
          </p>
        )}
      </div>
    </div>
  )
}

export default function EventsSection({ data, userId, onRefresh }) {
  const [showLog, setShowLog] = useState(false)
  const [showRaw, setShowRaw] = useState(false)

  const entries = [...(data?.entries ?? [])].reverse() // newest first

  const handleDelete = async (eventId) => {
    await api.deleteEvent(userId, eventId)
    onRefresh()
  }

  return (
    <section id="events" className="mb-16">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-1 h-6 rounded-full bg-amber-500" />
          <h2 className="text-white text-xl font-semibold">Events</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLog(true)}
            className="flex items-center gap-2 bg-amber-700 hover:bg-amber-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            <span className="text-base leading-none">+</span>
            Add Event
          </button>
          <button onClick={() => setShowRaw(true)} className="font-mono text-[10px] text-[#243450] hover:text-[#475569] px-1 transition-colors" title="raw data">{'{}'}</button>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-12 text-center">
          <p className="text-[#374d6c] text-4xl mb-3">📅</p>
          <p className="text-[#475569] text-sm">No events yet. Add your first doctor visit or blood draw.</p>
        </div>
      ) : (
        <div className="relative">
          {entries.map((ev) => (
            <EventCard key={ev.id} event={ev} onDelete={() => handleDelete(ev.id)} />
          ))}
          {/* Terminal dot */}
          <div className="flex gap-4">
            <div className="flex flex-col items-center w-3">
              <div className="w-2 h-2 rounded-full bg-[#243450] mx-auto" />
            </div>
          </div>
        </div>
      )}

      {showLog && (
        <LogModal
          type="event"
          onClose={() => setShowLog(false)}
          onSave={async (entry) => {
            await api.addEvent(userId, entry)
            onRefresh()
            setShowLog(false)
          }}
        />
      )}
      {showRaw && <RawDataModal label="events" data={data} onClose={() => setShowRaw(false)} />}
    </section>
  )
}
