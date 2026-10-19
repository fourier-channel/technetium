// Bulk update requests (BURs), read and decided as the viewer.
//
// HOW ONE ARRIVES. Somebody with Voice (+) or higher in #botsbotsbots types
// `!bur <reason>` and a script; Neru-chan files it on the booru under her own
// account and replies with the BUR's id under net.41chan.bur (fourier-tunnel
// capabilities/bur.js, operator 2026-10-19). That key is a POINTER, the same
// shape as net.41chan.media.tags' post_id: everything the card shows is read
// live from the booru, so its status is never a copy that went stale.
//
// WHO DECIDES. An admin, as THEMSELVES, through the booru session cookie --
// the same write path as a tag edit (booruTags.ts writeBooruTags): a simple
// POST with the CSRF token in the body, so no preflight is sent for the
// booru's Caddy rule to refuse. The booru's own policy then applies: approving
// needs the level the script's lines need (ADMIN for nearly all of them on
// this fork), rejecting needs admin or the BUR's creator. Nothing here
// approves on anyone's behalf.
//
// WHAT THE CARD OFFERS is decided by burActions() below, from what the booru
// says about the viewer. Until the booru names per-viewer can_approve /
// can_reject on the BUR itself (chanbooru, handed over 2026-10-19), the
// viewer's own booru level from /profile.json stands in: Admin sees the
// buttons, everyone else sees the status. A button that 403s is worse than no
// button (powerLevels.ts), and the booru's refusal still speaks if the two
// ever disagree.
import { BOORU_ORIGIN } from './booruUrl'
import { booruCsrfToken, resetBooruCsrf } from './booruCsrf'
import { reportIgnored } from './report'

/** The content key on Neru-chan's reply. */
export const BUR_KEY = 'net.41chan.bur'

/**
 * Who may point a card at a BUR. Only the bot that files them: anyone else's
 * message carrying the key is drawn as plain text, so a card can never be
 * forged to sit under somebody else's words.
 */
export const BUR_SENDERS: readonly string[] = ['@tunnel:41chan.net']

/** The BUR id an event points at, or null. Pure. */
export function burPointer(content: unknown, sender: string | null | undefined): number | null {
  if (!sender || !BUR_SENDERS.includes(sender)) return null
  if (!content || typeof content !== 'object') return null
  const v = (content as Record<string, unknown>)[BUR_KEY]
  if (!v || typeof v !== 'object') return null
  const id = (v as Record<string, unknown>).id
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null
}

export type BurStatus = 'pending' | 'processing' | 'approved' | 'rejected' | 'failed'
const STATUSES: readonly BurStatus[] = ['pending', 'processing', 'approved', 'rejected', 'failed']

export interface Bur {
  id: number
  status: BurStatus
  lines: string[]
  /** The booru's own per-viewer answer, when it gives one. */
  canApprove?: boolean
  canReject?: boolean
}

/** A BUR as the booru serialises it. Null for anything that is not one. Pure. */
export function parseBur(json: unknown): Bur | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  if (typeof o.id !== 'number' || !Number.isInteger(o.id)) return null
  if (typeof o.status !== 'string' || !STATUSES.includes(o.status as BurStatus)) return null
  const script = typeof o.script === 'string' ? o.script : ''
  const bur: Bur = {
    id: o.id,
    status: o.status as BurStatus,
    lines: script.split(/\r?\n/).map((l) => l.trim()).filter(Boolean),
  }
  if (typeof o.can_approve === 'boolean') bur.canApprove = o.can_approve
  if (typeof o.can_reject === 'boolean') bur.canReject = o.can_reject
  return bur
}

// Danbooru's level numbers (user.rb). Only Admin matters here.
export const BOORU_ADMIN = 50

export interface BurActions {
  approve: boolean
  reject: boolean
}

/**
 * What the card offers this viewer. Pure.
 *
 * The booru's own per-viewer answer wins when present. Otherwise: Admin may
 * approve a pending or failed BUR (a failed one can be approved again) and
 * reject a pending one; nobody else is offered anything. An unknown level
 * (null: not signed in to the booru, or the profile read failed) offers
 * nothing -- unmeasured is not permitted.
 */
export function burActions(bur: Bur, viewerLevel: number | null): BurActions {
  const admin = viewerLevel !== null && viewerLevel >= BOORU_ADMIN
  const approvable = bur.status === 'pending' || bur.status === 'failed'
  const rejectable = bur.status === 'pending'
  return {
    approve: approvable && (bur.canApprove ?? admin),
    reject: rejectable && (bur.canReject ?? admin),
  }
}

/** The words for a status, as the card says them. Pure. */
export function burStatusText(status: BurStatus): string {
  switch (status) {
    case 'pending':
      return 'waiting for an admin'
    case 'processing':
      return 'running on the booru now'
    case 'approved':
      return 'approved and applied'
    case 'rejected':
      return 'rejected; nothing changed'
    case 'failed':
      return 'failed part-way; an admin can approve it again'
  }
}

/** The booru's reasons, from a refusal body. Same three shapes Neru-chan reads. Pure. */
export function refusalText(json: unknown): string | null {
  if (!json || typeof json !== 'object') return null
  const o = json as Record<string, unknown>
  const out: string[] = []
  if (Array.isArray(o.errors)) {
    for (const e of o.errors) {
      if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).reason === 'string') {
        const line = (e as Record<string, unknown>).line
        const reason = (e as Record<string, unknown>).reason as string
        out.push(typeof line === 'number' ? `line ${line}: ${reason}` : reason)
      }
    }
  } else if (o.errors && typeof o.errors === 'object') {
    for (const msgs of Object.values(o.errors as Record<string, unknown>)) {
      for (const m of Array.isArray(msgs) ? msgs : [msgs]) if (typeof m === 'string') out.push(m)
    }
  }
  if (!out.length && typeof o.message === 'string' && o.message.trim()) out.push(o.message.trim())
  return out.length ? out.join('; ') : null
}

export function burPageUrl(id: number): string {
  return `${BOORU_ORIGIN}/bulk_update_requests/${id}`
}

/** Read one BUR as the viewer. Throws a sentence that names its fix. */
export async function readBur(id: number, fetchImpl: typeof fetch = fetch): Promise<Bur> {
  const res = await fetchImpl(`${BOORU_ORIGIN}/bulk_update_requests/${id}.json`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) {
    throw new Error(
      `the booru would not show BUR #${id} (HTTP ${res.status}). ` +
        'Fix: a 403 or 404 is usually a missing booru session -- open the booru panel once to sign in there, then reopen this room.',
    )
  }
  const bur = parseBur(await res.json())
  if (!bur) throw new Error(`the booru's answer for BUR #${id} was not a BUR. Fix: report it; the booru's BUR page still works.`)
  return bur
}

let levelMemo: Promise<number | null> | null = null

/** The viewer's booru level, once per page; null when unknown. */
export function viewerBooruLevel(fetchImpl: typeof fetch = fetch): Promise<number | null> {
  if (levelMemo) return levelMemo
  levelMemo = fetchImpl(`${BOORU_ORIGIN}/profile.json`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  })
    .then(async (r) => {
      if (!r.ok) return null
      const j = (await r.json()) as Record<string, unknown>
      return typeof j.level === 'number' ? j.level : null
    })
    .catch((err) => {
      // Unknown, not refused: the card shows the status and no buttons.
      reportIgnored('bur: viewer booru level', err)
      return null
    })
    .then((level) => {
      // An unknown answer is not remembered: the session may simply not
      // exist yet, and the next card should ask again.
      if (level === null) levelMemo = null
      return level
    })
  return levelMemo
}

/** For checks and sign-out. */
export function resetViewerBooruLevel(): void {
  levelMemo = null
}

async function decide(id: number, verb: 'approve' | 'reject', fetchImpl: typeof fetch): Promise<Bur> {
  const send = (csrf: string) => {
    const body = new URLSearchParams({ authenticity_token: csrf })
    // Reject is DELETE /bulk_update_requests/:id. Sent as a POST carrying
    // _method for the same reason a tag edit is: a real DELETE is not a
    // CORS-simple method and its preflight carries no cookie.
    if (verb === 'reject') body.set('_method', 'delete')
    const path = verb === 'approve' ? `/bulk_update_requests/${id}/approve.json` : `/bulk_update_requests/${id}.json`
    return fetchImpl(`${BOORU_ORIGIN}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    })
  }
  const csrf = await booruCsrfToken(fetchImpl)
  if (!csrf) {
    throw new Error(
      `could not read a CSRF token from the booru, so the ${verb} would be refused. ` +
        'Fix: open the booru panel once to sign in there, then try again.',
    )
  }
  let res = await send(csrf)
  // Same single retry as a tag edit: a replaced session invalidates the
  // cached token, and a second 422 is the booru refusing the BUR itself.
  if (res.status === 422) {
    resetBooruCsrf()
    const fresh = await booruCsrfToken(fetchImpl)
    if (fresh && fresh !== csrf) res = await send(fresh)
  }
  if (!res.ok) {
    let why: string | null = null
    try {
      why = refusalText(await res.json())
    } catch (err) {
      // The refusal is still reported, by status, just without the booru's words.
      reportIgnored('bur: refusal body', err)
    }
    throw new Error(
      `the booru refused to ${verb} BUR #${id} (HTTP ${res.status})` +
        (why ? `: ${why}` : '') +
        '. Fix: approving needs the level its lines need (Admin for nearly all of them); ' +
        'a 403 can also be a missing booru session -- open the booru panel once, then try again.',
    )
  }
  // The answer is the BUR as it now stands; read it again if the shape is off.
  try {
    const bur = parseBur(await res.json())
    if (bur) return bur
  } catch (err) {
    // The decision landed; only its echo was unreadable. Read it fresh.
    reportIgnored('bur: decision answer', err)
  }
  return readBur(id, fetchImpl)
}

export function approveBur(id: number, fetchImpl: typeof fetch = fetch): Promise<Bur> {
  return decide(id, 'approve', fetchImpl)
}

export function rejectBur(id: number, fetchImpl: typeof fetch = fetch): Promise<Bur> {
  return decide(id, 'reject', fetchImpl)
}
