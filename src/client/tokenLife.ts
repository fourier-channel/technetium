// ---------------------------------------------------------------------------
// The life of each token this sign-in holds, as sentences, for Manage session.
//
// PIP2: "The life of any given token is displayed at all times while hovering
// over Manage Session." True on the booru since 2026-09; Technetium had no such
// control and showed MAS's refresh token nowhere (claims sweep, 2026-10-04).
// The booru's card (chanbooru modulation_session_bar.js) is the idea: say what
// each token is, how long it has, and what happens when that runs out -- in
// the user's words, not a timestamp.
//
// Three things are described, and each one is honest about what is NOT known:
//
//   access token  -- five minutes at MAS; renewed on the next request after
//                    it lapses. Its expiry is what the server said at issue.
//   refresh token -- has no clock: spent and replaced each time the access
//                    token renews, and ended by logout.
//   the booru     -- what booru.41chan.net/modulation/session_status says of
//                    THIS browser's cookies: the booru account's session, and
//                    the picture gate's session with its expiry, which is the
//                    one booru cookie with a fixed end.
//
// Pure: every clock reading is handed in (G-tc02), so the checks can hold
// every sentence at any moment.
// ---------------------------------------------------------------------------

export type LifeTone = 'ok' | 'warn' | 'bad' | 'unknown'

export interface LifeLine {
  label: string
  text: string
  tone: LifeTone
}

// "4m 05s", "1h 07m", "3d 2h": the two largest units, which is what a person
// reads off a countdown.
export function formatSpan(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const two = (n: number) => String(n).padStart(2, '0')
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${two(m)}m`
  return `${m}m ${two(sec)}s`
}

export function accessTokenLine(expiresAt: number | undefined, now: number): LifeLine {
  const label = 'Access token'
  if (expiresAt === undefined) {
    return {
      label,
      tone: 'unknown',
      text: 'Its life was not recorded when this sign-in began (before this panel existed). It renews by itself whenever the server stops accepting it.',
    }
  }
  const left = expiresAt - now
  if (left > 0) {
    return { label, tone: 'ok', text: `${formatSpan(left)} left. It renews by itself on the first request after that.` }
  }
  return { label, tone: 'warn', text: `Lapsed ${formatSpan(-left)} ago. It renews by itself on the next request; there is nothing to do.` }
}

export function refreshTokenLine(held: boolean, issuedAt: number | undefined, now: number): LifeLine {
  const label = 'Refresh token'
  if (!held) {
    return { label, tone: 'bad', text: 'None. When the access token lapses this sign-in ends, and you sign in again.' }
  }
  const tail = 'It has no clock: it is spent and replaced each time the access token renews, and it ends when you log out.'
  if (issuedAt === undefined) {
    return { label, tone: 'unknown', text: `Held; when it was issued was not recorded (this sign-in is older than this panel). ${tail}` }
  }
  return { label, tone: 'ok', text: `Issued ${formatSpan(now - issuedAt)} ago. ${tail}` }
}

// What modulation/session_status answers, as far as this panel reads it.
// Everything optional: it is another service's JSON.
export interface BooruStatus {
  booru?: { signed_in?: boolean; name?: string | null; started_at?: number | null }
  matrix?: {
    linked?: boolean
    info?: { expires_at?: number | null } | null
  }
  // The booru's clock, epoch SECONDS: expiries are counted against it, then
  // carried onto ours, so a wrong clock here cannot make a pass look longer.
  now?: number
}

export type BooruRead =
  | { state: 'reading' }
  | { state: 'failed'; why: string }
  | { state: 'read'; status: BooruStatus; readAt: number }

export function booruLines(read: BooruRead | null, now: number): LifeLine[] {
  if (read === null || read.state === 'reading') {
    return [{ label: 'Booru', tone: 'unknown', text: "Reading the booru's session..." }]
  }
  if (read.state === 'failed') {
    return [{
      label: 'Booru',
      tone: 'bad',
      text: `Its session could not be read (${read.why}). Read it again, or open the booru and hover its Manage Session card.`,
    }]
  }
  const { status, readAt } = read
  const lines: LifeLine[] = []
  const acct = status.booru
  if (acct?.signed_in) {
    const since = typeof acct.started_at === 'number' && typeof status.now === 'number'
      ? `, for ${formatSpan((status.now - acct.started_at) * 1000 + (now - readAt))}`
      : ''
    lines.push({
      label: 'Booru account',
      tone: 'ok',
      text: `Signed in${acct.name ? ` as ${acct.name}` : ''}${since}. Its cookie's expiry renews with every booru page you load.`,
    })
  } else {
    lines.push({ label: 'Booru account', tone: 'unknown', text: 'Not signed in in this browser.' })
  }
  const pass = status.matrix
  const exp = pass?.info?.expires_at
  if (!pass?.linked) {
    lines.push({ label: 'Booru picture pass', tone: 'warn', text: "None: the booru will not show this account's Matrix pictures until one is made, which Technetium does on its own the next time it shows the booru or a picture's tags." })
  } else if (typeof exp === 'number' && typeof status.now === 'number') {
    // Remaining as the booru counted it, then aged by our own clock since.
    const left = (exp - status.now) * 1000 - (now - readAt)
    lines.push(left > 0
      ? { label: 'Booru picture pass', tone: 'ok', text: `${formatSpan(left)} left. Technetium trades in a fresh one each time the access token renews.` }
      : { label: 'Booru picture pass', tone: 'warn', text: `Ended ${formatSpan(-left)} ago. Technetium makes a new one the next time the access token renews.` })
  } else {
    lines.push({ label: 'Booru picture pass', tone: 'unknown', text: 'Active; the booru does not publish when it ends to this page.' })
  }
  return lines
}

// The read itself, with its fetch handed in. Credentialed, because the answer
// is about THIS browser's booru cookies; a GET with no custom headers, so no
// preflight for the booru's edge to refuse.
export async function readBooruStatus(
  fetchImpl: (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>,
  booruOrigin: string,
  now: () => number,
): Promise<BooruRead> {
  try {
    const r = await fetchImpl(`${booruOrigin}/modulation/session_status`, { credentials: 'include', headers: { Accept: 'application/json' } })
    if (!r.ok) return { state: 'failed', why: `HTTP ${r.status}` }
    const body = (await r.json()) as BooruStatus | null
    if (!body || typeof body !== 'object') return { state: 'failed', why: 'an answer that was not a session' }
    return { state: 'read', status: body, readAt: now() }
  } catch {
    return { state: 'failed', why: 'no answer' }
  }
}
