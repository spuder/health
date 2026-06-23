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

const NAV_IDS = ['body', 'sleep', 'exercise', 'heartrate', 'labs', 'events', 'import']

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
    <div className="min-h-screen bg-[#070b12] flex items-center justify-center">
      <div className="bg-[#0d1422] border border-[#1d2a3e] rounded-2xl p-8 w-full max-w-sm shadow-2xl">
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
  const [activeSection, setActiveSection] = useState('body')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [bodyData,      setBodyData]      = useState(null)
  const [sleepData,     setSleepData]     = useState(null)
  const [exerciseData,  setExerciseData]  = useState(null)
  const [heartrateData, setHeartrateData] = useState(null)
  const [bloodData,     setBloodData]     = useState(null)
  const [labReports,    setLabReports]    = useState(null)
  const [eventsData,    setEventsData]    = useState(null)
  const [loading, setLoading]       = useState(true)
  const [error,   setError]         = useState(null)

  const loadAll = useCallback(async () => {
    if (!currentUserId) return
    setLoading(true)
    setError(null)
    try {
      const [body, sleep, exercise, heartrate, blood, events, reports] = await Promise.all([
        api.getBody(currentUserId),
        api.getSleep(currentUserId),
        api.getExercise(currentUserId),
        api.getHeartRate(currentUserId),
        api.getBlood(currentUserId),
        api.getEvents(currentUserId),
        api.getLabReports(currentUserId),
      ])
      setBodyData(body)
      setSleepData(sleep)
      setExerciseData(exercise)
      setHeartrateData(heartrate)
      setBloodData(blood)
      setEventsData(events)
      setLabReports(reports)
    } catch (e) {
      setError('Could not connect to the API. Make sure the server is running on port 3001.')
    } finally {
      setLoading(false)
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
    loadAll()
  }, [currentUserId, loadAll])

  const handleNav = (id) => {
    setActiveSection(id)
    setSidebarOpen(false)
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  }

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
    <div className="min-h-screen bg-[#070b12]">
      <Sidebar active={activeSection} onNav={handleNav} isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Mobile top bar */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-20 h-14 bg-[#0a0f1a] border-b border-[#1d2a3e] flex items-center px-4 gap-3">
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
        <div className="mb-8 md:mb-10">
          <h1 className="text-white text-2xl md:text-3xl font-bold tracking-tight">
            {currentUser?.name ? `${currentUser.name.charAt(0).toUpperCase() + currentUser.name.slice(1)}'s Dashboard` : 'Dashboard'}
          </h1>
          <p className="text-[#475569] text-sm mt-1">Your personal health data, all in one place.</p>
        </div>

        {error && (
          <div className="bg-red-950 border border-red-800 text-red-300 text-sm px-4 py-3 rounded-xl mb-6 flex items-center justify-between">
            <span>⚠ {error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-300 ml-4">✕</button>
          </div>
        )}

        {loading ? (
          <div className="flex flex-col gap-4 animate-pulse">
            <div className="h-72 bg-[#0d1422] border border-[#1d2a3e] rounded-2xl" />
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[0,1,2].map(i => <div key={i} className="h-32 bg-[#0d1422] border border-[#1d2a3e] rounded-2xl" />)}
            </div>
          </div>
        ) : (
          <>
            <BodySection     data={bodyData}      events={eventsData} userId={currentUserId} onRefresh={loadAll} />
            <SleepSection    data={sleepData} />
            <ExerciseSection data={exerciseData}  userId={currentUserId} onRefresh={loadAll} />
            <HeartRateSection data={heartrateData} />
            <LabsSection     data={bloodData} />
            <EventsSection   data={eventsData}    userId={currentUserId} onRefresh={loadAll} />
            <ImportSection   userId={currentUserId} onRefresh={loadAll} reports={labReports?.reports ?? []} />
          </>
        )}
      </main>
    </div>
  )
}

// ── Root: decides which screen to show ───────────────────────
function AppInner() {
  const { users, loading } = useUser()

  if (loading) {
    return (
      <div className="min-h-screen bg-[#070b12] flex items-center justify-center">
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
