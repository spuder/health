import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const UserContext = createContext(null)

const STORAGE_KEY = 'hd_userId'

// A stored id is only usable if it's a non-empty string. An empty string in
// particular used to be writable here (the server once minted empty ids), and
// it reads back as falsy — which made `currentUserId` null while leaving a key
// in localStorage, so the auto-select below and the reconcile effect disagreed
// about whether a user had been chosen.
function readStoredUserId() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    return typeof stored === 'string' && stored.trim() ? stored : null
  } catch {
    return null  // private mode / blocked site data
  }
}

function writeStoredUserId(userId) {
  try {
    if (userId) localStorage.setItem(STORAGE_KEY, userId)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

export function UserProvider({ children }) {
  const [users, setUsers] = useState([])
  const [currentUserId, setCurrentUserId] = useState(readStoredUserId)
  const [loading, setLoading] = useState(true)

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users')
      const data = await res.json()
      setUsers(data)

      // Auto-select first user if nothing usable is stored
      if (!readStoredUserId() && data.length > 0) {
        setCurrentUserId(data[0].id)
        writeStoredUserId(data[0].id)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  // Reconcile the active id against the profiles that actually exist. Without
  // this, an id that is no longer in users.json — deleted on another device,
  // or renamed — stays selected, every `/api/<id>/...` call 404s via
  // requireUser, and the dashboard sits there with no route back. Falls back
  // to the first real profile, or to onboarding when there are none.
  useEffect(() => {
    if (loading) return
    if (currentUserId && users.some(u => u.id === currentUserId)) return

    const next = users.length > 0 ? users[0].id : null
    if (next === currentUserId) return
    setCurrentUserId(next)
    writeStoredUserId(next)
  }, [loading, users, currentUserId])

  const switchUser = (userId) => {
    const next = typeof userId === 'string' && userId.trim() ? userId : null
    setCurrentUserId(next)
    writeStoredUserId(next)
  }

  // Read the body exactly once and never let a non-JSON response (a proxy
  // error page, say) mask the real failure behind a parse error.
  const parseJson = async (res) => {
    const text = await res.text()
    try {
      return JSON.parse(text)
    } catch {
      return { error: `Unexpected ${res.status} response from the server` }
    }
  }

  const addUser = async ({ name, color, initials, height_inches, birth_year }) => {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, initials, height_inches, birth_year }),
    })
    const body = await parseJson(res)
    if (!res.ok) throw new Error(body.error || `Could not create the profile (${res.status})`)
    await loadUsers()
    return body.user
  }

  const updateUser = async (userId, data) => {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const body = await parseJson(res)
    if (!res.ok) throw new Error(body.error || `Could not update the profile (${res.status})`)
    await loadUsers()
  }

  const currentUser = users.find(u => u.id === currentUserId) ?? null

  return (
    <UserContext.Provider value={{ users, currentUser, currentUserId, switchUser, addUser, updateUser, loadUsers, loading }}>
      {children}
    </UserContext.Provider>
  )
}

export const useUser = () => useContext(UserContext)
