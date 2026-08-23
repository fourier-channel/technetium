// ---------------------------------------------------------------------------
// The two formats the thread card needs, kept pure so they can be checked.
//
// Both are borrowed from fourier-sampling's curate cards, where the point was
// that a COLUMN of cards be comparable at a glance: fixed-width absolute times
// that line up at the same x down the page, and a duration short enough to sit
// in a narrow column beside them.
// ---------------------------------------------------------------------------

// "22 Aug, 14:51". Day-month-time, 24 hour, no year -- a thread list is a
// recent-things list, and the year is the field that never varies and always
// costs width. Tabular numerals in the CSS keep the columns aligned.
export function formatCardWhen(ts: number | undefined | null): string {
  if (!ts || !Number.isFinite(ts)) return '--'
  return new Date(ts).toLocaleString([], {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}

// "4h 25m", "3d 4h", "12m". At most two units, largest first: a card has room
// for a glance, not for a precise interval, and "3d 4h 17m 9s" reads as noise
// at 10px.
export function formatDuration(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms) || ms < 0) return '--'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  if (h < 24) {
    const rm = m % 60
    return rm > 0 ? `${h}h ${rm}m` : `${h}h`
  }
  const d = Math.floor(h / 24)
  const rh = h % 24
  return rh > 0 ? `${d}d ${rh}h` : `${d}d`
}

// A thread with activity in the last day reads as still happening. The sampling
// card called this liveness and coloured it; here it is the same question asked
// of the only signal Matrix gives us, which is when somebody last posted.
export const LIVE_WINDOW_MS = 24 * 60 * 60 * 1000

export function isRecent(lastTs: number | undefined | null, now: number): boolean {
  if (!lastTs || !Number.isFinite(lastTs)) return false
  const age = now - lastTs
  // A future timestamp is not "very recent", it is a clock disagreeing. Treated
  // as not-recent rather than as maximally alive, so a skewed sender cannot
  // light up every card they touch.
  return age >= 0 && age < LIVE_WINDOW_MS
}
