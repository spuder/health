import ProfileSwitcher from './ProfileSwitcher'
import { useUser } from '../context/UserContext'

const NAV = [
  { id: 'body',      label: 'Body',      icon: '⚖️',  accent: '#7c3aed' },
  { id: 'sleep',     label: 'Sleep',     icon: '🌙',  accent: '#60a5fa' },
  { id: 'exercise',  label: 'Exercise',  icon: '🏃',  accent: '#f97316' },
  { id: 'heartrate', label: 'Heart Rate', icon: '❤️',  accent: '#f43f5e' },
  { id: 'labs',      label: 'Labs',      icon: '🧪',  accent: '#34d399' },
  { id: 'dna',       label: 'DNA',       icon: '🧬',  accent: '#22d3ee' },
  { id: 'events',    label: 'Events',    icon: '📅',  accent: '#f59e0b' },
  { id: 'protocols', label: 'Protocols', icon: '📋',  accent: '#a78bfa' },
  { id: 'import',    label: 'Import',    icon: '↑',   accent: '#a78bfa' },
]

export default function Sidebar({ active, onNav, isOpen, onClose, hiddenSections = new Set(), onOpenSettings }) {
  const { currentUser } = useUser()
  const accentColor = currentUser?.color ?? '#7c3aed'

  const handleNav = (id) => {
    onNav(id)
    onClose?.()
  }

  return (
    <>
      {/* Mobile overlay backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-20 md:hidden"
          onClick={onClose}
        />
      )}

      <aside className={`
        fixed left-0 top-0 h-screen w-56 bg-[#111826] border-r border-[#243450] flex flex-col z-30
        transition-transform duration-300
        md:translate-x-0
        ${isOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="px-5 pt-7 pb-5 border-b border-[#243450]">
          <div className="flex items-center gap-2.5">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-sm font-bold text-white"
              style={{ background: accentColor }}
            >
              ✦
            </div>
            <span className="text-white font-semibold text-sm tracking-tight">Health</span>
          </div>
          <p className="text-[#374d6c] text-[11px] mt-3">
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 overflow-y-auto">
          {NAV.map((item) => (
            <button
              key={item.id}
              onClick={() => handleNav(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl mb-1 text-sm transition-all text-left ${
                active === item.id
                  ? 'bg-[#1a2540] text-white'
                  : 'text-[#475569] hover:text-[#94a3b8] hover:bg-[#131d2e]'
              } ${hiddenSections.has(item.id) ? 'opacity-40' : ''}`}
            >
              <span className="text-base">{item.icon}</span>
              <span className="font-medium">{item.label}</span>
              {active === item.id && (
                <div className="ml-auto w-1.5 h-1.5 rounded-full" style={{ background: item.accent }} />
              )}
            </button>
          ))}
        </nav>

        {/* Profile switcher + settings gear */}
        <div className="border-t border-[#243450] p-3 flex items-center gap-2">
          <div className="flex-1 min-w-0">
            <ProfileSwitcher />
          </div>
          <button
            onClick={onOpenSettings}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-[#475569] hover:text-[#94a3b8] hover:bg-[#1a2540] transition-colors"
            title="Settings"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </aside>
    </>
  )
}
