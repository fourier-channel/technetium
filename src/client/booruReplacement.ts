// A creator's replacement of their own picture, as the booru records it, and
// their choice about the old version (operator, 2026-10-19).
//
// THE RULES ARE THE BOORU'S, and this module only reads and asks:
//   - every old version is kept 24 hours from the replacement, whatever was
//     chosen;
//   - "let it expire" can be undone (back to keep) only inside those 24 hours,
//     measured from the replacement and never from the last choice, so no
//     choice, reload or stale tab can move the deadline -- the booru enforces
//     it and refuses afterwards;
//   - keep can become expire at any time;
//   - once the booru's collector has scheduled the old file, nothing changes.
// So the card shows what the booru says (can_change, expires_at, state) and
// offers only what it allows; the booru's refusal still speaks if a clock
// here disagrees.
//
// The pointer is Neru-chan's reply: net.41chan.replacement {id, post_id}
// (fourier-tunnel capabilities/replace.js). Only her messages draw a card.
import { BUR_SENDERS } from './booruBur'
import { getAsViewer, postAsViewer } from './booruWrite'

export const REPLACEMENT_KEY = 'net.41chan.replacement'

export type Retention = 'keep' | 'expire'
export type OldFileState = 'held' | 'scheduled' | 'collected'

export interface Replacement {
  id: number
  postId: number | null
  retention: Retention | null
  /** ms since epoch; null when kept or unknown */
  expiresAt: number | null
  state: OldFileState | null
  canChange: boolean | null
}

/** The replacement id Neru-chan's reply points at, or null. Pure. */
export function replacementPointer(content: unknown, sender: string | null | undefined): number | null {
  if (!sender || !BUR_SENDERS.includes(sender)) return null
  if (!content || typeof content !== 'object') return null
  const v = (content as Record<string, unknown>)[REPLACEMENT_KEY]
  if (!v || typeof v !== 'object') return null
  const id = (v as Record<string, unknown>).id
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

/** The booru's replacement record, or null for anything else. Pure. */
export function parseReplacement(json: unknown): Replacement | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (typeof o.id !== 'number' || !Number.isInteger(o.id)) return null
  const retention = o.old_file_retention === 'keep' || o.old_file_retention === 'expire' ? o.old_file_retention : null
  const at = typeof o.old_file_expires_at === 'string' ? Date.parse(o.old_file_expires_at) : NaN
  const state =
    o.old_file_state === 'held' || o.old_file_state === 'scheduled' || o.old_file_state === 'collected' ? o.old_file_state : null
  return {
    id: o.id,
    postId: typeof o.post_id === 'number' ? o.post_id : null,
    retention,
    expiresAt: Number.isFinite(at) ? at : null,
    state,
    canChange: typeof o.can_change === 'boolean' ? o.can_change : null,
  }
}

/**
 * What the card offers. Pure. Only what the booru says is allowed: can_change
 * must be true, the file must not be scheduled or collected, and the offer is
 * the OTHER choice. An unknown answer offers nothing.
 */
export function replacementOffer(r: Replacement): Retention | null {
  if (r.canChange !== true) return null
  if (r.state === 'scheduled' || r.state === 'collected') return null
  if (r.retention === 'expire') return 'keep'
  if (r.retention === 'keep') return 'expire'
  return null
}

/** What the card says about the old version. Pure; `now` from useNow (G-tc02). */
export function oldVersionText(r: Replacement, now: number): string {
  if (r.state === 'collected') return 'The old version has been deleted.'
  if (r.state === 'scheduled') return 'The old version is scheduled for deletion.'
  if (r.retention === 'keep') return 'The old version is kept.'
  if (r.retention === 'expire' && r.expiresAt !== null) {
    const left = r.expiresAt - now
    if (left <= 0) return 'The old version has expired and will be collected for deletion.'
    const h = Math.floor(left / 3_600_000)
    const m = Math.max(1, Math.round((left % 3_600_000) / 60_000))
    return `The old version is deleted in ${h > 0 ? `${h} h ${m} min` : `${m} min`} unless you keep it.`
  }
  return 'What happens to the old version is not known yet.'
}

export async function readReplacement(id: number, fetchImpl: typeof fetch = fetch): Promise<Replacement> {
  const res = await getAsViewer(`/post_replacements/${id}.json`, fetchImpl)
  if (!res.ok) {
    throw new Error(
      `the booru would not show replacement #${id} (HTTP ${res.status}). ` +
        'Fix: a 403 or 404 is usually a missing booru session -- open the booru panel once to sign in there, then reopen this room.',
    )
  }
  const r = parseReplacement(await res.json())
  if (!r) throw new Error(`the booru's answer for replacement #${id} was not a replacement. Fix: report it.`)
  return r
}

/** Ask the booru to change the old-version choice; resolves the record as it now stands. */
export async function setRetention(id: number, to: Retention, fetchImpl: typeof fetch = fetch): Promise<Replacement> {
  // A missing session throws NoBooruSession, whose message already names its fix.
  const res = await postAsViewer(`/post_replacements/${id}.json`, { 'post_replacement[old_file_retention]': to }, fetchImpl, 'put')
  if (!res.ok) {
    let why = ''
    try {
      const j = (await res.json()) as Record<string, unknown>
      if (typeof j.message === 'string') why = `: ${j.message}`
    } catch {
      why = ''
    }
    throw new Error(
      `the booru did not change the old version's fate (HTTP ${res.status})${why}. ` +
        'Fix: the 24 hours to keep it may have passed, or the booru session is missing -- open the booru panel once, then try again.',
    )
  }
  return readReplacement(id, fetchImpl)
}
