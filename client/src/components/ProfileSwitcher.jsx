import { useState, useRef, useEffect } from 'react'
import { useUser } from '../context/UserContext'

const PALETTE = [
  '#7c3aed', '#059669', '#2563eb', '#db2777',
  '#d97706', '#0891b2', '#dc2626', '#65a30d',
]

function Avatar({ user, size = 'md' }) {
  const dim = size === 'sm' ? 'w-7 h-7 text-xs' : size === 'lg' ? 'w-10 h-10 text-sm' : 'w-8 h-8 text-xs'
  return (
    <div
      className={`${dim} rounded-full flex items-center justify-center font-semibold flex-shrink-0`}
      style={{ background: user?.color ?? '#374151' }}
    >
      {user?.initials ?? '??'}
    </div>
  )
}

function AddMemberForm({ onAdd, onCancel }) {
  const [name, setName]               = useState('')
  const [color, setColor]             = useState(PALETTE[1])
  const [heightFt, setHeightFt]       = useState('')
  const [heightIn, setHeightIn]       = useState('')
  const [loading, setLoading]         = useState(false)
  const [error, setError]             = useState(null)
  const { addUser, switchUser }       = useUser()

  const initials = name.trim()
    ? name.trim().split(/\s+/).map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : '??'

  const height_inches = heightFt || heightIn
    ? (parseInt(heightFt || 0) * 12) + parseInt(heightIn || 0)
    : null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!name.trim()) return
    setLoading(true)
    setError(null)
    try {
      const user = await addUser({ name: name.trim(), color, initials, height_inches })
      switchUser(user.id)
      onAdd()
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="p-4 border-t border-[#1d2a3e]">
      <p className="text-white text-xs font-semibold mb-3">Add family member</p>

      {/* Preview + name */}
      <div className="flex items-center gap-3 mb-3">
        <Avatar user={{ initials, color }} size="lg" />
        <input
          autoFocus
          type="text"
          placeholder="Name"
          value={name}
          onChange={e => setName(e.target.value)}
          className="flex-1 bg-[#070b12] border border-[#1d2a3e] text-white text-sm rounded-lg px-3 py-2 focus:border-[#7c3aed] outline-none"
        />
      </div>

      {/* Color picker */}
      <div className="flex gap-2 mb-3">
        {PALETTE.map(c => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            className="w-5 h-5 rounded-full flex-shrink-0 transition-transform hover:scale-110"
            style={{
              background: c,
              ring: color === c ? `2px solid white` : 'none',
              outline: color === c ? `2px solid ${c}` : 'none',
              outlineOffset: '2px',
            }}
          />
        ))}
      </div>

      {/* Height */}
      <div className="flex gap-2 mb-3">
        <input
          type="number" min="0" max="8" placeholder="ft"
          value={heightFt} onChange={e => setHeightFt(e.target.value)}
          className="w-16 bg-[#070b12] border border-[#1d2a3e] text-white text-sm rounded-lg px-2 py-1.5 focus:border-[#7c3aed] outline-none"
        />
        <input
          type="number" min="0" max="11" placeholder="in"
          value={heightIn} onChange={e => setHeightIn(e.target.value)}
          className="w-16 bg-[#070b12] border border-[#1d2a3e] text-white text-sm rounded-lg px-2 py-1.5 focus:border-[#7c3aed] outline-none"
        />
        <span className="text-[#475569] text-xs self-center">height (optional)</span>
      </div>

      {error && <p className="text-red-400 text-xs mb-2">{error}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onCancel}
          className="flex-1 bg-[#141d2e] text-[#64748b] text-xs py-2 rounded-lg hover:text-white transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={!name.trim() || loading}
          className="flex-1 bg-[#7c3aed] hover:bg-[#6d28d9] disabled:opacity-40 text-white text-xs py-2 rounded-lg transition-colors">
          {loading ? 'Adding…' : 'Add member'}
        </button>
      </div>
    </form>
  )
}

export { Avatar }

export default function ProfileSwitcher() {
  const { users, currentUser, switchUser } = useUser()
  const [open, setOpen]     = useState(false)
  const [adding, setAdding] = useState(false)
  const ref                 = useRef(null)

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  if (!currentUser) return null

  return (
    <div ref={ref} className="relative">
      {/* Trigger */}
      <button
        onClick={() => { setOpen(!open); setAdding(false) }}
        className="w-full flex items-center gap-3 px-3 py-3 rounded-xl hover:bg-[#0d1422] transition-all group"
      >
        <Avatar user={currentUser} />
        <div className="flex-1 text-left min-w-0">
          <p className="text-white text-sm font-medium truncate">{currentUser.name}</p>
          <p className="text-[#2d3d58] text-[11px] group-hover:text-[#475569] transition-colors">Switch profile</p>
        </div>
        <svg className="w-3.5 h-3.5 text-[#2d3d58] group-hover:text-[#475569] transition-colors flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8 9l4-4 4 4M16 15l-4 4-4-4"/>
        </svg>
      </button>

      {/* Popover */}
      {open && (
        <div className="absolute bottom-full left-0 right-0 mb-2 bg-[#0d1422] border border-[#1d2a3e] rounded-2xl shadow-2xl overflow-hidden z-50">
          {/* User list */}
          <div className="p-2">
            {users.map(user => (
              <button
                key={user.id}
                onClick={() => { switchUser(user.id); setOpen(false) }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all ${
                  user.id === currentUser.id ? 'bg-[#141d2e]' : 'hover:bg-[#141d2e]'
                }`}
              >
                <Avatar user={user} size="sm" />
                <span className="text-white text-sm flex-1">{user.name}</span>
                {user.id === currentUser.id && (
                  <svg className="w-3.5 h-3.5 flex-shrink-0" style={{ color: user.color }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                  </svg>
                )}
              </button>
            ))}
          </div>

          {/* Add member */}
          {adding ? (
            <AddMemberForm onAdd={() => { setAdding(false); setOpen(false) }} onCancel={() => setAdding(false)} />
          ) : (
            <div className="border-t border-[#1d2a3e] p-2">
              <button
                onClick={() => setAdding(true)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[#475569] hover:text-[#94a3b8] hover:bg-[#141d2e] text-sm transition-all"
              >
                <div className="w-7 h-7 rounded-full border border-dashed border-[#2d3d58] flex items-center justify-center text-xs flex-shrink-0">+</div>
                Add family member
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
