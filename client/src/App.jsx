import { useState, useEffect, useCallback } from 'react'
import { UserProvider, useUser } from './context/UserContext'
import { api } from './api'
import Sidebar from './components/Sidebar'
import BodySection from './components/BodySection'
import SleepSection from './components/SleepSection'
import ExerciseSection from './components/ExerciseSection'
import HeartRateSection from './components/HeartRateSection'
import LabsSection from './components/LabsSection'
import EventsSection from './components/EventsSection'
import ImportSection from './components/ImportSection'
import ProtocolsSection from './components/ProtocolsSection'
import SettingsSection from './components/SettingsSection'
import ExportModal from './components/ExportModal'

const NAV_IDS = ['body', 'sleep', 'exercise', 'heartrate', 'labs', 'events', 'protocols', 'import']

function useHiddenSections(userId) {
  const storageKey = userId ? `health_hidden_sections_${userId}` : null
  const [hiddenSections, setHiddenSections] = useState(() => {
    if (!storageKey) return new Set()
    try {
      const stored = localStorage.getItem(storageKey)
      return stored ? new Set(JSON.parse(stored)) : new Set()
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    if (!storageKey) return
    try {
      const stored = localStorage.getItem(storageKey)
      setHiddenSections(stored ? new Set(JSON.parse(stored)) : new Set())
    } catch {
      setHiddenSections(new Set())
    }
  }, [storageKey])

  const toggleSection = useCallback((id) => {
    setHiddenSections(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      if (storageKey) localStorage.setItem(storageKey, JSON.stringify([...next]))
      return next
    })
  }, [storageKey])

  return { hiddenSections, toggleSection }
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `${r}, ${g}, ${b}`
}

// ── Onboarding (no users yet) ────────────────────────────────
function OnboardingScreen() {
  const { addUser, switchUser } = useUser()
  const [name, setName]           = useState('')
  const [heightFt, setHeightFt]   = useState('')
  const [heightIn, setHeightIn]   = useState('')
  const [birthYear, setBirthYear] = useState('')
  const [loading, setLoading]     = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    const height_inches = heightFt || heightIn
      ? (parseInt(heightFt || 0) * 12) + parseInt(heightIn || 0)
      : null
    const birth_year = birthYear ? parseInt(birthYear) : null
    const initials = name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
    const user = await addUser({ name: name.trim(), initials, color: '#7c3aed', height_inches, birth_year })
    switchUser(user.id)
  }

  return (
    <div className="min-h-screen bg-[#0d1520] flex items-center justify-center">
      <div className="bg-[#131d2e] border border-[#243450] rounded-2xl p-8 w-full max-w-sm shadow-2xl">
        <div className="w-10 h-10 rounded-xl bg-[#7c3aed] flex items-center justify-center text-xl mb-6">✦</div>
        <h1 className="text-white text-xl font-bold mb-1">Welcome to Health</h1>
        <p className="text-[#475569] text-sm mb-6">Create your profile to get started.</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="text-[#94a3b8] text-xs font-medium block mb-1.5">Your name</label>
            <input autoFocus type="text" placeholder="Spencer" value={name} onChange={e => setName(e.target.value)} required />
          </div>
          <div>
            <label className="text-[#94a3b8] text-xs font-medium block mb-1.5">
              Height & birth year <span className="text-[#475569] font-normal">(optional)</span>
            </label>
            <div className="flex gap-2">
              <input type="number" min="0" max="8" placeholder="5 ft" value={heightFt} onChange={e => setHeightFt(e.target.value)} style={{ width: 72 }} />
              <input type="number" min="0" max="11" placeholder="11 in" value={heightIn} onChange={e => setHeightIn(e.target.value)} style={{ width: 72 }} />
              <input type="number" min="1920" max={new Date().getFullYear() - 10} placeholder="1990" value={birthYear} onChange={e => setBirthYear(e.target.value)} style={{ width: 88 }} />
            </div>
          </div>
          <button type="submit" disabled={!name.trim() || loading}
            className="bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 text-white font-medium py-2.5 rounded-xl transition-colors mt-2">
            {loading ? 'Creating…' : 'Create profile'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Main dashboard (user selected) ───────────────────────────
function Dashboard() {
  const { currentUser, currentUserId } = useUser()
  const { hiddenSections, toggleSection } = useHiddenSections(currentUserId)
  const [activeSection, setActiveSection] = useState(() => sessionStorage.getItem('activeSection') ?? 'body')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [showExport, setShowExport] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [printSections, setPrintSections] = useState(null)
  const [bodyData,      setBodyData]      = useState(null)
  const [sleepData,     setSleepData]     = useState(null)
  const [exerciseData,  setExerciseData]  = useState(null)
  const [heartrateData, setHeartrateData] = useState(null)
  const [bloodData,     setBloodData]     = useState(null)
  const [labReports,    setLabReports]    = useState(null)
  const [eventsData,    setEventsData]    = useState(null)
  const [protocolsData, setProtocolsData] = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error,   setError]         = useState(null)

  const loadAll = useCallback(async ({ showLoading = false } = {}) => {
    if (!currentUserId) return
    if (showLoading) setLoading(true)
    setError(null)
    try {
      const [body, sleep, exercise, heartrate, blood, events, reports, protocols] = await Promise.all([
        api.getBody(currentUserId),
        api.getSleep(currentUserId),
        api.getExercise(currentUserId),
        api.getHeartRate(currentUserId),
        api.getBlood(currentUserId),
        api.getEvents(currentUserId),
        api.getLabReports(currentUserId),
        api.getProtocols(currentUserId),
      ])
      setBodyData(body)
      setSleepData(sleep)
      setExerciseData(exercise)
      setHeartrateData(heartrate)
      setBloodData(blood)
      setEventsData(events)
      setLabReports(reports)
      setProtocolsData(protocols)
    } catch (e) {
      setError('Could not connect to the API. Make sure the server is running on port 3001.')
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [currentUserId])

  // Reload when user switches
  useEffect(() => {
    setBodyData(null)
    setSleepData(null)
    setExerciseData(null)
    setHeartrateData(null)
    setBloodData(null)
    setEventsData(null)
    setLabReports(null)
    setProtocolsData(null)
    loadAll({ showLoading: true })
  }, [currentUserId, loadAll])

  const handleNav = (id) => {
    setActiveSection(id)
    setSidebarOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

  function handlePrint(selected) {
    setShowExport(false)
    setPrintSections(selected)
    setTimeout(() => {
      window.print()
      window.addEventListener('afterprint', () => setPrintSections(null), { once: true })
    }, 100)
  }

  async function handleExportPng(selected) {
    setShowExport(false)
    setPrintSections(selected)
    // Wait for React to re-render with excluded sections hidden
    await new Promise(r => setTimeout(r, 150))
    const { default: html2canvas } = await import('html2canvas')
    const main = document.querySelector('main')
    const canvas = await html2canvas(main, {
      backgroundColor: '#0d1520',
      scale: 2,
      useCORS: true,
      height: main.scrollHeight,
      windowHeight: main.scrollHeight,
      onclone: (doc) => {
        const el = doc.querySelector('main')
        if (!el) return
        el.style.marginLeft = '0'
        el.style.paddingTop = '24px'
        el.style.maxWidth = 'none'
        el.style.overflow = 'visible'
        doc.querySelectorAll('.no-print').forEach(n => { n.style.display = 'none' })
      },
    })
    const link = document.createElement('a')
    link.download = `health-${new Date().toISOString().slice(0, 10)}.png`
    link.href = canvas.toDataURL('image/png')
    link.click()
    setPrintSections(null)
  }

  // Persist active section to session storage
  useEffect(() => {
    sessionStorage.setItem('activeSection', activeSection)
  }, [activeSection])

  // After load, scroll back to the section the user was on
  useEffect(() => {
    if (!loading) {
      const saved = sessionStorage.getItem('activeSection')
      if (saved && saved !== 'body') {
        document.getElementById(saved)?.scrollIntoView({ behavior: 'instant' })
      }
    }
  }, [loading])

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => entries.forEach(e => { if (e.isIntersecting) setActiveSection(e.target.id) }),
      { rootMargin: '-40% 0px -40% 0px' }
    )
    if (!loading) {
      NAV_IDS.forEach(id => { const el = document.getElementById(id); if (el) observer.observe(el) })
    }
    return () => observer.disconnect()
  }, [loading])

  return (
    <div className="min-h-screen bg-[#0d1520]" style={{ backgroundImage: `radial-gradient(ellipse 120% 60% at 60% 0%, rgba(${hexToRgb(currentUser?.color ?? '#7c3aed')}, 0.18) 0%, transparent 100%), radial-gradient(ellipse 60% 40% at 100% 100%, rgba(${hexToRgb(currentUser?.color ?? '#7c3aed')}, 0.07) 0%, transparent 70%)` }}>
      <Sidebar active={activeSection} onNav={handleNav} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} hiddenSections={hiddenSections} onOpenSettings={() => setShowSettings(true)} />

      {/* Mobile top bar */}
      <div className="no-print md:hidden fixed top-0 left-0 right-0 z-20 h-14 bg-[#111826] border-b border-[#243450] flex items-center px-4 gap-3">
        <button
          onClick={() => setSidebarOpen(o => !o)}
          className="w-8 h-8 flex flex-col justify-center gap-1.5 text-[#94a3b8] hover:text-white"
          aria-label="Toggle menu"
        >
          <span className="block h-0.5 w-5 bg-current rounded" />
          <span className="block h-0.5 w-5 bg-current rounded" />
          <span className="block h-0.5 w-5 bg-current rounded" />
        </button>
        <span className="text-white font-semibold text-sm tracking-tight">Health</span>
      </div>

      <main className="md:ml-56 px-4 md:px-10 py-6 md:py-10 pt-20 md:pt-10 max-w-5xl">
        {/* Page header */}
        <div className="no-print mb-8 md:mb-10 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-white text-2xl md:text-3xl font-bold tracking-tight">
              {currentUser?.name ? `${currentUser.name.charAt(0).toUpperCase() + currentUser.name.slice(1)}'s Dashboard` : 'Dashboard'}
            </h1>
            <p className="text-[#475569] text-sm mt-1">Your personal health data, all in one place.</p>
          </div>
          <button
            onClick={() => setShowExport(true)}
            className="no-print flex-shrink-0 flex items-center gap-2 text-[#475569] hover:text-[#94a3b8] border border-[#243450] hover:border-[#374d6c] text-xs font-medium px-3 py-2 rounded-xl transition-colors mt-1"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            Export
          </button>
        </div>

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-300 text-sm px-4 py-3 rounded-xl mb-6 flex items-center justify-between">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300 ml-4">✕</button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-4 animate-pulse">
            <div className="h-72 bg-[#131d2e] border border-[#243450] rounded-2xl" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[0,1,2].map(i => <div key={i} className="h-32 bg-[#131d2e] border border-[#243450] rounded-2xl" />)}
            </div>
          </div>
        ) : (
          <>
            {!hiddenSections.has('body')      && <div className={printSections && !printSections.body      ? 'print-exclude' : ''}><BodySection      data={bodyData}      events={eventsData} userId={currentUserId} onRefresh={loadAll} /></div>}
            {!hiddenSections.has('sleep')     && <div className={printSections && !printSections.sleep     ? 'print-exclude' : ''}><SleepSection     data={sleepData} /></div>}
            {!hiddenSections.has('exercise')  && <div className={printSections && !printSections.exercise  ? 'print-exclude' : ''}><ExerciseSection  data={exerciseData}  userId={currentUserId} onRefresh={loadAll} /></div>}
            {!hiddenSections.has('heartrate') && <div className={printSections && !printSections.heartrate ? 'print-exclude' : ''}><HeartRateSection data={heartrateData} /></div>}
            {!hiddenSections.has('labs')      && <div className={printSections && !printSections.labs      ? 'print-exclude' : ''}><LabsSection      data={bloodData}     reports={labReports?.reports ?? []} /></div>}
            {!hiddenSections.has('events')    && <div className={printSections && !printSections.events    ? 'print-exclude' : ''}><EventsSection    data={eventsData}    userId={currentUserId} onRefresh={loadAll} /></div>}
            {!hiddenSections.has('protocols') && <div className="print-exclude"><ProtocolsSection data={protocolsData ?? []} userId={currentUserId} onRefresh={loadAll} /></div>}
            {!hiddenSections.has('import')    && <div className="print-exclude"><ImportSection userId={currentUserId} onRefresh={loadAll} reports={labReports?.reports ?? []} /></div>}
          </>
        )}
      </main>
      {showExport && <ExportModal onClose={() => setShowExport(false)} onPrint={handlePrint} onExportPng={handleExportPng} />}
      {showSettings && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setShowSettings(false)} />
          <div className="relative bg-[#131d2e] border border-[#243450] rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#243450]">
              <h2 className="text-white font-semibold text-sm">Settings</h2>
              <button onClick={() => setShowSettings(false)} className="text-[#475569] hover:text-[#94a3b8] transition-colors">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-5">
              <SettingsSection hiddenSections={hiddenSections} onToggle={toggleSection} />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Root: decides which screen to show ───────────────────────
function AppInner() {
  const { users, loading } = useUser()

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0d1520] flex items-center justify-center">
        <div className="w-8 h-8 rounded-lg bg-[#7c3aed] animate-pulse" />
      </div>
    )
  }

  if (users.length === 0) return <OnboardingScreen />
  return <Dashboard />
}

export default function App() {
  return (
    <UserProvider>
      <AppInner />
    </UserProvider>
  )
}
