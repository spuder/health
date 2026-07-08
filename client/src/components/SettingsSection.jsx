const CATEGORIES = [
  { id: 'body',      label: 'Body',       icon: '⚖️',  description: 'Weight, BMI, and body composition' },
  { id: 'sleep',     label: 'Sleep',      icon: '🌙',  description: 'Sleep duration and quality' },
  { id: 'exercise',  label: 'Exercise',   icon: '🏃',  description: 'Workouts and activity' },
  { id: 'heartrate', label: 'Heart Rate', icon: '❤️',  description: 'Resting and active heart rate' },
  { id: 'labs',      label: 'Labs',       icon: '🧪',  description: 'Blood work and lab results' },
  { id: 'events',    label: 'Life Events', icon: '📅', description: 'Milestones and logged events' },
  { id: 'protocols', label: 'Protocols',  icon: '📋',  description: 'Supplement and health protocols' },
  { id: 'import',    label: 'Import',     icon: '↑',   description: 'Data import tools' },
]

export default function SettingsSection({ hiddenSections, onToggle }) {
  return (
    <div>
      <p className="text-[#475569] text-xs mb-4">Choose which sections appear on your dashboard.</p>
      <div className="rounded-xl overflow-hidden border border-[#243450]">
        <div className="px-4 py-2.5 bg-[#0d1520] border-b border-[#243450]">
          <span className="text-[#94a3b8] text-xs font-semibold uppercase tracking-wider">Dashboard sections</span>
        </div>
        <div className="divide-y divide-[#1e2d42]">
          {CATEGORIES.map((cat) => {
            const hidden = hiddenSections.has(cat.id)
            return (
              <div key={cat.id} className="flex items-center justify-between px-5 py-4">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{cat.icon}</span>
                  <div>
                    <p className="text-white text-sm font-medium">{cat.label}</p>
                    <p className="text-[#475569] text-xs mt-0.5">{cat.description}</p>
                  </div>
                </div>
                <button
                  onClick={() => onToggle(cat.id)}
                  className={`relative w-10 h-5.5 rounded-full transition-colors duration-200 flex-shrink-0 ${
                    hidden ? 'bg-[#1e2d42]' : 'bg-[#7c3aed]'
                  }`}
                  style={{ height: 22, width: 40 }}
                  aria-pressed={!hidden}
                >
                  <span
                    className="absolute top-0.5 left-0.5 w-[18px] h-[18px] bg-white rounded-full shadow transition-transform duration-200"
                    style={{ transform: hidden ? 'translateX(0)' : 'translateX(18px)' }}
                  />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
