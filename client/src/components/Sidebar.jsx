import ProfileSwitcher from './ProfileSwitcher'
import { useUser } from '../context/UserContext'

const NAV = [
  { id: 'body',      label: 'Body',      icon: '⚖️',  accent: '#7c3aed' },
  { id: 'sleep',     label: 'Sleep',     icon: '🌙',  accent: '#60a5fa' },
  { id: 'exercise',  label: 'Exercise',  icon: '🏃',  accent: '#f97316' },
  { id: 'heartrate', label: 'Heart Rate', icon: '❤️',  accent: '#f43f5e' },
  { id: 'labs',      label: 'Labs',      icon: '🧪',  accent: '#34d399' },
  { id: 'events',    label: 'Events',    icon: '📅',  accent: '#f59e0b' },
]

export default function Sidebar({ active, onNav }) {
  const { currentUser } = useUser()
  const accentColor = currentUser?.color ?? '#7c3aed'

  return (
    <aside className="fixed left-0 top-0 h-screen w-56 bg-[#0a0f1a] border-r border-[#1d2a3e] flex flex-col z-10">
      {/* Logo */}
      <div className="px-5 pt-7 pb-5 border-b border-[#1d2a3e]">
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold text-white"
            style={{ background: accentColor }}
          >
            ✦
          </div>
          <span className="text-white font-semibold text-sm tracking-tight">Health</span>
        </div>
        <p className="text-[#2d3d58] text-[11px] mt-3">
          {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
        </p>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto">
        {NAV.map(item => (
          <button
            key={item.id}
            onClick={() => onNav(item.id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm transition-all text-left ${
              active === item.id
                ? 'bg-[#141d2e] text-white'
                : 'text-[#475569] hover:text-[#94a3b8] hover:bg-[#0d1422]'
            }`}
          >
            <span className="text-base">{item.icon}</span>
            <span className="font-medium">{item.label}</span>
            {active === item.id && (
              <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: item.accent }} />
            )}
          </button>
        ))}
      </nav>

      {/* Profile switcher */}
      <div className="border-t border-[#1d2a3e] p-3">
        <ProfileSwitcher />
      </div>
    </aside>
  )
}
