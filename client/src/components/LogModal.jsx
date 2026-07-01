import { useState, useEffect, useRef } from 'react'

function today() {
  return new Date().toISOString().split('T')[0]
}

function calcBMI(weightLbs, heightInches) {
  if (!weightLbs || !heightInches) return ''
  return ((weightLbs / (heightInches * heightInches)) * 703).toFixed(1)
}

function Field({ label, sublabel, children }) {
  return (
    <div>
      <label className="block text-[#94a3b8] text-xs font-medium mb-1.5">
        {label}
        {sublabel && <span className="text-[#475569] font-normal ml-1">{sublabel}</span>}
      </label>
      {children}
    </div>
  )
}

function BodyForm({ heightInches, onSubmit, onClose, loading }) {
  const [date, setDate] = useState(today())
  const [weight, setWeight] = useState('')
  const [smm, setSmm] = useState('')
  const [vf, setVf] = useState('')
  const [notes, setNotes] = useState('')

  const bmi = calcBMI(parseFloat(weight), heightInches)

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!weight) return
    onSubmit({ date, weight: parseFloat(weight), bmi: bmi ? parseFloat(bmi) : undefined, skeletal_muscle_mass: smm ? parseFloat(smm) : undefined, visceral_fat: vf ? parseFloat(vf) : undefined, notes: notes || undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </Field>
        <Field label="Weight" sublabel="(lbs)">
          <input type="number" step="0.1" placeholder="182.4" value={weight} onChange={e => setWeight(e.target.value)} required />
        </Field>
      </div>

      {bmi && (
        <div className="bg-[#0d1520] border border-[#243450] rounded-lg px-3 py-2 flex items-center gap-2">
          <span className="text-[#475569] text-xs">Calculated BMI:</span>
          <span className="text-white text-sm font-semibold">{bmi}</span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Skeletal Muscle Mass" sublabel="(%) — optional">
          <input type="number" step="0.1" placeholder="42.6" value={smm} onChange={e => setSmm(e.target.value)} />
        </Field>
        <Field label="Visceral Fat" sublabel="(1–20) — optional">
          <input type="number" step="1" min="1" max="20" placeholder="9" value={vf} onChange={e => setVf(e.target.value)} />
        </Field>
      </div>

      <Field label="Notes" sublabel="— optional">
        <textarea rows={2} placeholder="Post-cheat day, morning, etc." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'none' }} />
      </Field>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="flex-1 bg-[#1a2540] border border-[#243450] hover:border-[#374d6c] text-[#94a3b8] text-sm font-medium py-2.5 rounded-lg transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !weight} className="flex-1 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
          {loading ? 'Saving...' : 'Log Entry'}
        </button>
      </div>
    </form>
  )
}

function BloodForm({ onSubmit, onClose, loading }) {
  const [date, setDate] = useState(today())
  const [testosterone, setTestosterone] = useState('')
  const [triglycerides, setTriglycerides] = useState('')
  const [notes, setNotes] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    onSubmit({ date, testosterone: testosterone ? parseFloat(testosterone) : undefined, triglycerides: triglycerides ? parseFloat(triglycerides) : undefined, notes: notes || undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <Field label="Date">
        <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Testosterone" sublabel="(ng/dL)">
          <input type="number" step="1" placeholder="612" value={testosterone} onChange={e => setTestosterone(e.target.value)} />
        </Field>
        <Field label="Triglycerides" sublabel="(mg/dL)">
          <input type="number" step="1" placeholder="118" value={triglycerides} onChange={e => setTriglycerides(e.target.value)} />
        </Field>
      </div>

      <Field label="Notes" sublabel="— optional">
        <textarea rows={2} placeholder="Quest Diagnostics, fasted, etc." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'none' }} />
      </Field>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="flex-1 bg-[#1a2540] border border-[#243450] hover:border-[#374d6c] text-[#94a3b8] text-sm font-medium py-2.5 rounded-lg transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading} className="flex-1 bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
          {loading ? 'Saving...' : 'Log Panel'}
        </button>
      </div>
    </form>
  )
}

function ExerciseForm({ onSubmit, onClose, loading }) {
  const [date, setDate] = useState(today())
  const [minutes, setMinutes] = useState('')
  const [hrMins, setHrMins] = useState('')
  const [notes, setNotes] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!minutes) return
    onSubmit({
      date,
      exercise_minutes: parseFloat(minutes),
      hr_hard_minutes:  hrMins ? parseFloat(hrMins) : undefined,
      notes:            notes || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </Field>
        <Field label="Duration" sublabel="(minutes)">
          <input type="number" step="1" min="1" placeholder="45" value={minutes} onChange={e => setMinutes(e.target.value)} required />
        </Field>
      </div>

      <Field label="Min HR &gt; 80% max" sublabel="— optional">
        <input type="number" step="1" min="0" placeholder="22" value={hrMins} onChange={e => setHrMins(e.target.value)} />
      </Field>

      <Field label="Notes" sublabel="— optional">
        <textarea rows={2} placeholder="Morning run, strength session, etc." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'none' }} />
      </Field>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="flex-1 bg-[#1a2540] border border-[#243450] hover:border-[#374d6c] text-[#94a3b8] text-sm font-medium py-2.5 rounded-lg transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !minutes} className="flex-1 bg-orange-600 hover:bg-orange-500 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
          {loading ? 'Saving...' : 'Log Session'}
        </button>
      </div>
    </form>
  )
}

function SleepForm({ onSubmit, onClose, loading }) {
  const [date, setDate] = useState(today())
  const [hours, setHours] = useState('')
  const [quality, setQuality] = useState('')
  const [notes, setNotes] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!hours) return
    onSubmit({
      date,
      sleep_hours:   parseFloat(hours),
      sleep_quality: quality ? parseFloat(quality) : undefined,
      notes:         notes || undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </Field>
        <Field label="Duration" sublabel="(hours)">
          <input type="number" step="0.25" min="0" max="24" placeholder="7.5" value={hours} onChange={e => setHours(e.target.value)} required />
        </Field>
      </div>

      <Field label="Quality" sublabel="(1–10) — optional">
        <input type="number" step="1" min="1" max="10" placeholder="8" value={quality} onChange={e => setQuality(e.target.value)} />
      </Field>

      <Field label="Notes" sublabel="— optional">
        <textarea rows={2} placeholder="Woke up once, good dreams, etc." value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'none' }} />
      </Field>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="flex-1 bg-[#1a2540] border border-[#243450] hover:border-[#374d6c] text-[#94a3b8] text-sm font-medium py-2.5 rounded-lg transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !hours} className="flex-1 bg-[#3b82f6] hover:bg-[#2563eb] disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
          {loading ? 'Saving...' : 'Log Sleep'}
        </button>
      </div>
    </form>
  )
}

function EventForm({ onSubmit, onClose, loading }) {
  const [date, setDate] = useState(today())
  const [type, setType] = useState('doctor_visit')
  const [label, setLabel] = useState('')
  const [notes, setNotes] = useState('')

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!label) return
    onSubmit({ date, type, label, notes: notes || undefined })
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Date">
          <input type="date" value={date} onChange={e => setDate(e.target.value)} required />
        </Field>
        <Field label="Type">
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="doctor_visit">Doctor Visit</option>
            <option value="blood_draw">Blood Draw</option>
            <option value="life_event">Life Event</option>
          </select>
        </Field>
      </div>

      <Field label="Label">
        <input type="text" placeholder="Annual checkup, cardiology follow-up…" value={label} onChange={e => setLabel(e.target.value)} required />
      </Field>

      <Field label="Notes" sublabel="— optional">
        <textarea rows={2} placeholder="Dr. Chen, Quest Diagnostics, fasted…" value={notes} onChange={e => setNotes(e.target.value)} style={{ resize: 'none' }} />
      </Field>

      <div className="flex gap-3 pt-2">
        <button type="button" onClick={onClose} className="flex-1 bg-[#1a2540] border border-[#243450] hover:border-[#374d6c] text-[#94a3b8] text-sm font-medium py-2.5 rounded-lg transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={loading || !label} className="flex-1 bg-amber-700 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-medium py-2.5 rounded-lg transition-colors">
          {loading ? 'Saving...' : 'Add Event'}
        </button>
      </div>
    </form>
  )
}

const TITLES = {
  body:     'Log Body Entry',
  blood:    'Log Blood Panel',
  sleep:    'Log Sleep',
  exercise: 'Log Exercise',
  event:    'Add Event',
}

export default function LogModal({ type, heightInches, onClose, onSave }) {
  const [loading, setLoading] = useState(false)
  const overlayRef = useRef(null)

  // Close on Escape
  useEffect(() => {
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  const handleSave = async (entry) => {
    setLoading(true)
    try {
      await onSave(entry)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(7, 11, 18, 0.85)', backdropFilter: 'blur(6px)' }}
      onClick={(e) => { if (e.target === overlayRef.current) onClose() }}
    >
      <div className="bg-[#131d2e] border border-[#243450] rounded-2xl shadow-2xl w-full max-w-md">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#243450]">
          <h2 className="text-white font-semibold text-base">{TITLES[type]}</h2>
          <button onClick={onClose} className="text-[#475569] hover:text-[#94a3b8] text-xl transition-colors leading-none">
            ✕
          </button>
        </div>

        {/* Form */}
        <div className="px-6 py-5">
          {type === 'body'  && <BodyForm  heightInches={heightInches} onSubmit={handleSave} onClose={onClose} loading={loading} />}
          {type === 'blood' && <BloodForm onSubmit={handleSave} onClose={onClose} loading={loading} />}
          {type === 'sleep'    && <SleepForm    onSubmit={handleSave} onClose={onClose} loading={loading} />}
          {type === 'exercise' && <ExerciseForm onSubmit={handleSave} onClose={onClose} loading={loading} />}
          {type === 'event' && <EventForm onSubmit={handleSave} onClose={onClose} loading={loading} />}
        </div>
      </div>
    </div>
  )
}
