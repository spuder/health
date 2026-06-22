import { createContext, useContext, useState, useEffect, useCallback } from 'react'

const UserContext = createContext(null)

export function UserProvider({ children }) {
  const [users, setUsers] = useState([])
  const [currentUserId, setCurrentUserId] = useState(
    () => localStorage.getItem('hd_userId') || null
  )
  const [loading, setLoading] = useState(true)

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch('/api/users')
      const data = await res.json()
      setUsers(data)

      // Auto-select first user if nothing stored
      if (!localStorage.getItem('hd_userId') && data.length > 0) {
        setCurrentUserId(data[0].id)
        localStorage.setItem('hd_userId', data[0].id)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadUsers() }, [loadUsers])

  const switchUser = (userId) => {
    setCurrentUserId(userId)
    localStorage.setItem('hd_userId', userId)
  }

  const addUser = async ({ name, color, initials, height_inches, birth_year }) => {
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, color, initials, height_inches, birth_year }),
    })
    if (!res.ok) throw new Error((await res.json()).error)
    const { user } = await res.json()
    await loadUsers()
    return user
  }

  const updateUser = async (userId, data) => {
    const res = await fetch(`/api/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error((await res.json()).error)
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
