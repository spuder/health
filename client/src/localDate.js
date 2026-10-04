// Every date this app stores is a plain local calendar day — a sleep night, a
// weigh-in, a lab draw. `toISOString()` formats in UTC, so west of UTC it names
// tomorrow from early evening onward (and east of UTC it names yesterday in the
// early morning). Comparing or defaulting against that shifts the day by one.
export function toLocalDateStr(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// The local calendar day `days` days before today, as "YYYY-MM-DD".
export function localDateDaysAgo(days) {
  const d = new Date()
  d.setDate(d.getDate() - days)
  return toLocalDateStr(d)
}
