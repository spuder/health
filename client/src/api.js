async function req(path, options = {}) {
  const res = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  })
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`)
  return res.json()
}

export const api = {
  // ── Users ─────────────────────────────────────────────────
  getUsers:   ()           => req('/users'),
  addUser:    (data)       => req('/users', { method: 'POST', body: JSON.stringify(data) }),
  deleteUser: (userId)     => req(`/users/${userId}`, { method: 'DELETE' }),

  // ── Body ──────────────────────────────────────────────────
  getBody:    (userId)     => req(`/${userId}/body`),
  logBody:    (userId, e)  => req(`/${userId}/body`,    { method: 'POST', body: JSON.stringify(e) }),
  deleteBody: (userId, id) => req(`/${userId}/body/${id}`, { method: 'DELETE' }),

  // ── Blood ─────────────────────────────────────────────────
  getBlood:    (userId)     => req(`/${userId}/blood`),
  logBlood:    (userId, e)  => req(`/${userId}/blood`,    { method: 'POST', body: JSON.stringify(e) }),
  deleteBlood: (userId, id) => req(`/${userId}/blood/${id}`, { method: 'DELETE' }),

  // ── Sleep ─────────────────────────────────────────────────
  getSleep:    (userId)     => req(`/${userId}/sleep`),
  logSleep:    (userId, e)  => req(`/${userId}/sleep`, { method: 'POST', body: JSON.stringify(e) }),

  // ── Exercise ──────────────────────────────────────────────
  getExercise: (userId)     => req(`/${userId}/exercise`),
  logExercise: (userId, e)  => req(`/${userId}/exercise`, { method: 'POST', body: JSON.stringify(e) }),

  // ── Heart Rate ────────────────────────────────────────────
  getHeartRate: (userId)    => req(`/${userId}/heartrate`),

  // ── Events ────────────────────────────────────────────────
  getEvents:    (userId)     => req(`/${userId}/events`),
  addEvent:     (userId, e)  => req(`/${userId}/events`,    { method: 'POST', body: JSON.stringify(e) }),
  deleteEvent:  (userId, id) => req(`/${userId}/events/${id}`, { method: 'DELETE' }),

  // ── Import ────────────────────────────────────────────────
  getImportStats:    (userId)          => req(`/${userId}/import/stats`),
  importAppleHealth: (userId, payload) =>
    req(`/${userId}/import/apple-health`, { method: 'POST', body: JSON.stringify(payload) }),

  importLabsPdf: async (userId, file) => {
    const form = new FormData()
    form.append('pdf', file)
    const res = await fetch(`/api/${userId}/import/labs-pdf`, { method: 'POST', body: form })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? `Upload failed (${res.status})`)
    return json
  },
}
